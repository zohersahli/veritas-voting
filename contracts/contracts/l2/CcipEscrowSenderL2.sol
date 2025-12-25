// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/*
Escrow لكل Poll على L2 بالـ LINK:
- يقفل مبلغ لتغطية CCIP fee (مع هامش)
- يقفل منصة 7% (لا تخرج إلا عند الإرسال وحسب الحالة)
- يسمح بالإرسال permissionless بعد finalize
- يسمح بالـ top-up permissionless
- يسمح بسحب المتبقي لمنشئ التصويت بعد الإرسال

Per-poll LINK escrow on L2:
- locks a budget for CCIP fees (with a margin)
- locks a 7% platform fee (released based on final status at send-time)
- allows permissionless send after finalize
- allows permissionless top-up
- allows leftover withdrawal by the poll creator after send
*/

import { IRouterClient } from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { Client } from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { Polls } from "./Polls.sol";
import { FinalizationL2 } from "./FinalizationL2.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


abstract contract CcipEscrowSenderL2 is Polls, FinalizationL2, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -----------------------------
    // Errors
    // -----------------------------
    error BadConfig();
    error MissingEscrow(uint256 pollId);
    error NotCreator(uint256 pollId);
    error NotFinalized(uint256 pollId);
    error NotReadyStatus(uint256 pollId);
    error AlreadySent(uint256 pollId);
    error InsufficientEscrow(uint256 pollId, uint256 needed, uint256 available);
    error TopUpAfterSend(uint256 pollId);
    error InvalidBps(uint16 value);

    // ACK allowlist (L1 -> L2)
    error UnauthorizedAckSourceChain(uint64 got);
    error UnauthorizedAckSender(address got);
    error AckAlreadyProcessed(bytes32 key);
    error AckNotReceived(bytes32 key);

    // -----------------------------
    // Storage: Config
    // -----------------------------
    IRouterClient public ccipRouter;
    IERC20 public linkToken;

    uint64 public destinationChainSelector;
    address public l1Receiver;
    address public treasury;

    uint256 public receiverGasLimit;
    uint16 public platformFeeBps;
    uint16 public feeMarginBps;
    uint256 public feeMarginFlat;

    uint64 public ackSourceChainSelector; // L1 selector
    address public ackSender; // L1 Receiver contract

    // Ops fee (flat) paid always at poll creation time to treasury
    uint256 public opsFeeFlat;

    // -----------------------------
    // Storage: Escrow per poll
    // -----------------------------
    struct Escrow {
        bool exists;
        bool sent;
        address creator;
        uint256 groupId;

        uint256 deposited;
        uint256 reservedMaxFee;
        uint256 reservedPlatform;

        bytes32 messageId;
    }

    mapping(uint256 => Escrow) public escrows;

    mapping(bytes32 => bool) public ackReceived;

    // -----------------------------
    // Events
    // -----------------------------
    event CcipConfigUpdated(
        address router,
        address link,
        uint64 destSelector,
        address l1Receiver,
        address treasury,
        uint256 gasLimit,
        uint16 platformFeeBps,
        uint16 feeMarginBps,
        uint256 feeMarginFlat,
        uint256 opsFeeFlat
    );

    event EscrowLocked(
        uint256 indexed pollId,
        uint256 indexed groupId,
        address indexed creator,
        uint256 deposited,
        uint256 reservedMaxFee,
        uint256 reservedPlatform
    );

    event EscrowToppedUp(uint256 indexed pollId, address indexed from, uint256 amount, uint256 newTotal);

    event ResultSentToL1(uint256 indexed pollId, bytes32 indexed messageId, uint256 feePaid);

    event PlatformFeeTransferred(uint256 indexed pollId, address indexed treasury, uint256 amount);

    event LeftoverWithdrawn(uint256 indexed pollId, address indexed to, uint256 amount);

    event AckConfigUpdated(uint64 ackSourceSelector, address ackSender);
    event L1AckReceived(
        bytes32 indexed key,
        uint256 indexed groupId,
        uint256 indexed pollId,
        bytes32 inboundMessageId,
        bytes32 ackMessageId
    );

    event OpsFeeCharged(uint256 indexed pollId, address indexed payer, address indexed treasury, uint256 amount);
    event OpsFeeUpdated(uint256 oldFee, uint256 newFee);

    // -----------------------------
    // Constructor
    // -----------------------------
    /*
    يجهز إعدادات CCIP الأساسية على L2.
    Sets the base CCIP configuration on L2.
    */
    constructor(
        address router,
        address link,
        uint64 destSelector,
        address _l1Receiver,
        address _treasury,
        uint256 _receiverGasLimit
    ) {
        if (router == address(0) || link == address(0) || _l1Receiver == address(0) || _treasury == address(0)) {
            revert BadConfig();
        }
        if (destSelector == 0 || _receiverGasLimit == 0) revert BadConfig();

        ccipRouter = IRouterClient(router);
        linkToken = IERC20(link);

        destinationChainSelector = destSelector;
        l1Receiver = _l1Receiver;
        treasury = _treasury;

        receiverGasLimit = _receiverGasLimit;

        platformFeeBps = 700;
        feeMarginBps = 2000;
        feeMarginFlat = 0;

        // Default ops fee for local/testing, adjustable by owner
        // 0.01 LINK (18 decimals)
        opsFeeFlat = 1e16;

        emit CcipConfigUpdated(
            router,
            link,
            destSelector,
            _l1Receiver,
            _treasury,
            _receiverGasLimit,
            platformFeeBps,
            feeMarginBps,
            feeMarginFlat,
            opsFeeFlat
        );
    }

    // -----------------------------
    // Admin setters
    // -----------------------------
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert BadConfig();
        treasury = newTreasury;
    }

    function setL1Receiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert BadConfig();
        l1Receiver = newReceiver;
    }

    function setReceiverGasLimit(uint256 newGasLimit) external onlyOwner {
        if (newGasLimit == 0) revert BadConfig();
        receiverGasLimit = newGasLimit;
    }

    function setFeeMargin(uint16 newMarginBps, uint256 newFlat) external onlyOwner {
        if (newMarginBps > 10_000) revert InvalidBps(newMarginBps);
        feeMarginBps = newMarginBps;
        feeMarginFlat = newFlat;
    }

    function setPlatformFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > 10_000) revert InvalidBps(newBps);
        platformFeeBps = newBps;
    }

    // -----------------------------
    // Create poll with LINK escrow
    // -----------------------------
    function createPollWithLinkEscrow(
        uint256 groupId,
        string calldata title,
        string calldata cid,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        bool quorumEnabled,
        uint16 quorumBps
    ) external whenNotPaused nonReentrant returns (uint256 pollId) {
        // 1) Create poll (internal)
        pollId = _createPoll(groupId, title, cid, options, startTime, endTime, quorumEnabled, quorumBps);

        // 2) Quote fee using placeholder payload (same size as final payload)
        Client.EVM2AnyMessage memory msgForQuote =
            _buildMessage(groupId, pollId, uint8(ResultStatus.Unknown), bytes32(0));

        uint256 fee = ccipRouter.getFee(destinationChainSelector, msgForQuote);

        // 3) Apply margin
        uint256 maxFee = fee + ((fee * feeMarginBps) / 10_000) + feeMarginFlat;

        // 4) Reserve platform fee based on maxFee (simple & stable)
        uint256 platformFee = (maxFee * platformFeeBps) / 10_000;

        // 5) Ops fee (always charged, even if FailedQuorum later)
        uint256 opsFee = opsFeeFlat;

        // Total the user pays now
        uint256 totalRequired = maxFee + platformFee + opsFee;

        // 6) Pull LINK once
        linkToken.safeTransferFrom(msg.sender, address(this), totalRequired);

        // 7) Immediately pay ops fee to treasury (L2)
        if (opsFee > 0) {
            linkToken.safeTransfer(treasury, opsFee);
            emit OpsFeeCharged(pollId, msg.sender, treasury, opsFee);
        }

        // 8) Escrow balance excludes ops fee
        uint256 escrowDeposited = maxFee + platformFee;

        escrows[pollId] = Escrow({
            exists: true,
            sent: false,
            creator: msg.sender,
            groupId: groupId,
            deposited: escrowDeposited,
            reservedMaxFee: maxFee,
            reservedPlatform: platformFee,
            messageId: bytes32(0)
        });

        emit EscrowLocked(pollId, groupId, msg.sender, escrowDeposited, maxFee, platformFee);
    }

    // -----------------------------
    // Top-up
    // -----------------------------
    /*
    Allows anyone to top up the poll escrow.
    ملاحظة: ليست Pausable حسب قرارنا, لكن عليها nonReentrant لأنها تحويل.
    */
    function topUpLink(uint256 pollId, uint256 amount) external nonReentrant {
        Escrow storage e = escrows[pollId];
        if (!e.exists) revert MissingEscrow(pollId);
        if (e.sent) revert TopUpAfterSend(pollId);
        if (amount == 0) revert BadConfig();

        linkToken.safeTransferFrom(msg.sender, address(this), amount);
        e.deposited += amount;

        emit EscrowToppedUp(pollId, msg.sender, amount, e.deposited);
    }

    // -----------------------------
    // Send result to L1
    // -----------------------------
    function sendResultToL1(uint256 pollId) external whenNotPaused nonReentrant returns (bytes32 messageId) {
        Escrow storage e = escrows[pollId];
        if (!e.exists) revert MissingEscrow(pollId);
        if (e.sent) revert AlreadySent(pollId);

        FinalizedResult memory r = results[pollId];
        if (!r.finalized) revert NotFinalized(pollId);
        if (r.status == ResultStatus.Unknown) revert NotReadyStatus(pollId);

        bytes32 resultHash = _computeResultHash(pollId);
        Client.EVM2AnyMessage memory message = _buildMessage(e.groupId, pollId, uint8(r.status), resultHash);

        uint256 fee = ccipRouter.getFee(destinationChainSelector, message);

        if (fee > e.deposited) {
            revert InsufficientEscrow(pollId, fee, e.deposited);
        }

        linkToken.forceApprove(address(ccipRouter), fee);

        // effects before external call
        e.sent = true;

        messageId = ccipRouter.ccipSend(destinationChainSelector, message);
        e.messageId = messageId;

        e.deposited -= fee;

        if (r.status != ResultStatus.Passed) {
            e.reservedPlatform = 0;
        }

        emit ResultSentToL1(pollId, messageId, fee);
    }

    // -----------------------------
    // Claim platform fee (after L1 confirmation)
    // -----------------------------
    function claimPlatformFee(uint256 pollId) external nonReentrant onlyOwner {
        Escrow storage e = escrows[pollId];
        if (!e.exists) revert MissingEscrow(pollId);
        if (!e.sent) revert BadConfig();

        FinalizedResult memory r = results[pollId];
        if (!r.finalized) revert NotFinalized(pollId);

        if (r.status != ResultStatus.Passed) revert NotReadyStatus(pollId);

        bytes32 k = keccak256(abi.encode(e.groupId, pollId));
        if (!ackReceived[k]) revert AckNotReceived(k);

        uint256 pf = e.reservedPlatform;
        if (pf == 0) revert BadConfig();
        if (pf > e.deposited) revert InsufficientEscrow(pollId, pf, e.deposited);

        e.reservedPlatform = 0;
        e.deposited -= pf;

        linkToken.safeTransfer(treasury, pf);
        emit PlatformFeeTransferred(pollId, treasury, pf);
    }

    // -----------------------------
    // Withdraw leftovers
    // -----------------------------
    function withdrawLeftover(uint256 pollId) external nonReentrant {
        Escrow storage e = escrows[pollId];
        if (!e.exists) revert MissingEscrow(pollId);
        if (msg.sender != e.creator) revert NotCreator(pollId);
        if (!e.sent) revert BadConfig();

        uint256 locked = e.reservedPlatform;
        uint256 withdrawable = e.deposited;

        if (locked > 0) {
            if (locked > withdrawable) revert InsufficientEscrow(pollId, locked, withdrawable);
            withdrawable -= locked;
            e.deposited = locked;
        } else {
            e.deposited = 0;
        }

        if (withdrawable > 0) {
            linkToken.safeTransfer(msg.sender, withdrawable);
        }

        emit LeftoverWithdrawn(pollId, msg.sender, withdrawable);
    }

    // -----------------------------
    // Internals
    // -----------------------------
    function _buildMessage(
        uint256 groupId,
        uint256 pollId,
        uint8 statusRaw,
        bytes32 resultHash
    ) internal view returns (Client.EVM2AnyMessage memory) {
        bytes memory receiver = abi.encode(l1Receiver);
        bytes memory data = abi.encode(groupId, pollId, statusRaw, resultHash);

        Client.EVMExtraArgsV1 memory extraArgs = Client.EVMExtraArgsV1({ gasLimit: receiverGasLimit });

        return Client.EVM2AnyMessage({
            receiver: receiver,
            data: data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(extraArgs),
            feeToken: address(linkToken)
        });
    }

    function _computeResultHash(uint256 pollId) internal view returns (bytes32) {
        FinalizedResult memory r = results[pollId];
        return keccak256(abi.encode(pollId, r.status, r.winningOption, r.totalVotes));
    }

    // -----------------------------
    // ACK config + receive
    // -----------------------------
    function setAckConfig(uint64 sourceSelector, address sender) external onlyOwner {
        if (sourceSelector == 0 || sender == address(0)) revert BadConfig();
        ackSourceChainSelector = sourceSelector;
        ackSender = sender;
        emit AckConfigUpdated(sourceSelector, sender);
    }

    function ccipReceive(Client.Any2EVMMessage calldata message) external {
        if (msg.sender != address(ccipRouter)) revert BadConfig();
        if (message.sourceChainSelector != ackSourceChainSelector) {
            revert UnauthorizedAckSourceChain(message.sourceChainSelector);
        }

        address decodedSender = abi.decode(message.sender, (address));
        if (decodedSender != ackSender) revert UnauthorizedAckSender(decodedSender);

        (uint256 groupId, uint256 pollId, uint8 statusRaw, bytes32 resultHash, bytes32 inboundMessageId) =
            abi.decode(message.data, (uint256, uint256, uint8, bytes32, bytes32));

        bytes32 k = keccak256(abi.encode(groupId, pollId));
        if (ackReceived[k]) revert AckAlreadyProcessed(k);

        ackReceived[k] = true;

        // keep decode stable for audit clarity
        statusRaw;
        resultHash;

        emit L1AckReceived(k, groupId, pollId, inboundMessageId, message.messageId);
    }

    function setOpsFeeFlat(uint256 newFee) external onlyOwner {
        uint256 oldFee = opsFeeFlat;
        opsFeeFlat = newFee;
        emit OpsFeeUpdated(oldFee, newFee);
    }
}
