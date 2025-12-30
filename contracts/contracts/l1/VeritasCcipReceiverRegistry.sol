// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { CCIPReceiver } from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import { IRouterClient } from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { Client } from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract VeritasCcipReceiverRegistry is CCIPReceiver, Ownable {
    using SafeERC20 for IERC20;

    enum ResultStatus {
        Unknown,
        Passed,
        FailedQuorum
    }

    struct Record {
        bool recorded;
        uint256 groupId;
        uint256 pollId;
        ResultStatus status;
        bytes32 resultHash;

        bytes32 inboundMessageId; // L2 -> L1 message id
        bytes32 ackMessageId;     // L1 -> L2 ack message id
        uint64 recordedAt;
    }

    // Allowlist for inbound messages (L2 -> L1)
    uint64 public allowedSourceChainSelector;
    address public allowedSender;

    // ACK config (L1 -> L2)
    uint64 public ackDestinationChainSelector;
    address public ackL2Receiver;
    IERC20 public ackFeeToken; // LINK on L1
    uint256 public ackGasLimit;

    // key = keccak256(abi.encode(groupId, pollId))
    mapping(bytes32 => Record) private _records;

    // Events
    event AllowedSourceChainSelectorUpdated(uint64 oldValue, uint64 newValue);
    event AllowedSenderUpdated(address indexed oldValue, address indexed newValue);

    event AckConfigUpdated(
        uint64 destSelector,
        address indexed l2Receiver,
        address indexed feeToken,
        uint256 gasLimit
    );

    event ResultRecorded(
        bytes32 indexed key,
        uint256 indexed groupId,
        uint256 indexed pollId,
        ResultStatus status,
        bytes32 resultHash,
        bytes32 inboundMessageId
    );

    event AckSent(
        bytes32 indexed key,
        bytes32 indexed ackMessageId,
        uint256 feePaid
    );

    // Errors
    error AlreadyRecorded(bytes32 key);
    error UnauthorizedSourceChain(uint64 got);
    error UnauthorizedSender(address got);
    error BadConfig();
    error InvalidStatus(uint8 got);
    error InvalidPollId();
    error AckConfigNotSet();

    constructor(
        address router,
        uint64 _allowedSourceChainSelector,
        address _allowedSender
    ) CCIPReceiver(router) Ownable(msg.sender) {
        if (router == address(0) || _allowedSender == address(0) || _allowedSourceChainSelector == 0) {
            revert BadConfig();
        }
        allowedSourceChainSelector = _allowedSourceChainSelector;
        allowedSender = _allowedSender;
    }

    function keyOf(uint256 groupId, uint256 pollId) public pure returns (bytes32) {
        return keccak256(abi.encode(groupId, pollId));
    }

    // Admin setters (inbound allowlist)
    function setAllowedSourceChainSelector(uint64 newSelector) external onlyOwner {
        if (newSelector == 0) revert BadConfig();
        uint64 oldValue = allowedSourceChainSelector;
        allowedSourceChainSelector = newSelector;
        emit AllowedSourceChainSelectorUpdated(oldValue, newSelector);
    }

    function setAllowedSender(address newSender) external onlyOwner {
        if (newSender == address(0)) revert BadConfig();
        address oldValue = allowedSender;
        allowedSender = newSender;
        emit AllowedSenderUpdated(oldValue, newSender);
    }

    // Admin setters (ACK config)
    function setAckConfig(
        uint64 destSelector,
        address l2Receiver,
        address feeToken,
        uint256 gasLimit
    ) external onlyOwner {
        if (destSelector == 0 || l2Receiver == address(0) || feeToken == address(0) || gasLimit == 0) {
            revert BadConfig();
        }
        ackDestinationChainSelector = destSelector;
        ackL2Receiver = l2Receiver;
        ackFeeToken = IERC20(feeToken);
        ackGasLimit = gasLimit;

        emit AckConfigUpdated(destSelector, l2Receiver, feeToken, gasLimit);
    }

    // Views
    function getRecord(uint256 groupId, uint256 pollId) external view returns (Record memory) {
        return _records[keyOf(groupId, pollId)];
    }

    function isRecorded(uint256 groupId, uint256 pollId) external view returns (bool) {
        return _records[keyOf(groupId, pollId)].recorded;
    }

    // CCIP receive (L2 -> L1)
    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        // 1) validate source chain
        if (message.sourceChainSelector != allowedSourceChainSelector) {
            revert UnauthorizedSourceChain(message.sourceChainSelector);
        }

        // 2) validate sender
        address decodedSender = abi.decode(message.sender, (address));
        if (decodedSender != allowedSender) {
            revert UnauthorizedSender(decodedSender);
        }

        // 3) decode payload
        (uint256 groupId, uint256 pollId, uint8 statusRaw, bytes32 resultHash) =
            abi.decode(message.data, (uint256, uint256, uint8, bytes32));

        if (pollId == 0) revert InvalidPollId();
        if (statusRaw > uint8(ResultStatus.FailedQuorum)) revert InvalidStatus(statusRaw);

        bytes32 k = keyOf(groupId, pollId);

        // 4) record once
        if (_records[k].recorded) revert AlreadyRecorded(k);

        ResultStatus status = ResultStatus(statusRaw);

        _records[k] = Record({
            recorded: true,
            groupId: groupId,
            pollId: pollId,
            status: status,
            resultHash: resultHash,
            inboundMessageId: message.messageId,
            ackMessageId: bytes32(0),
            recordedAt: uint64(block.timestamp)
        });

        emit ResultRecorded(k, groupId, pollId, status, resultHash, message.messageId);

        // 5) ACK must be configured (we want on-chain fee integrity)
        if (
            ackDestinationChainSelector == 0 ||
            ackL2Receiver == address(0) ||
            address(ackFeeToken) == address(0) ||
            ackGasLimit == 0
        ) {
            revert AckConfigNotSet();
        }

        // 6) build ACK message
        bytes memory receiver = abi.encode(ackL2Receiver);
        bytes memory data = abi.encode(groupId, pollId, statusRaw, resultHash, message.messageId);

        Client.EVMExtraArgsV1 memory extraArgs = Client.EVMExtraArgsV1({ gasLimit: ackGasLimit });

        Client.EVM2AnyMessage memory ackMsg = Client.EVM2AnyMessage({
            receiver: receiver,
            data: data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(extraArgs),
            feeToken: address(ackFeeToken)
        });

        // 7) pay fee in LINK from this contract balance
        IRouterClient router = IRouterClient(getRouter());
        uint256 fee = router.getFee(ackDestinationChainSelector, ackMsg);

        ackFeeToken.forceApprove(address(router), fee);

        bytes32 ackId = router.ccipSend(ackDestinationChainSelector, ackMsg);
        _records[k].ackMessageId = ackId;

        emit AckSent(k, ackId, fee);
    }
}
