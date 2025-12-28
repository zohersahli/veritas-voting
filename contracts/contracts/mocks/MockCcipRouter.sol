// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Client } from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICCIPReceiverLike {
    function ccipReceive(Client.Any2EVMMessage calldata message) external;
}

/*
Mock CCIP Router for localhost testing.
*/
contract MockCcipRouter {
    uint64 public sourceChainSelector;
    uint256 public flatFee;

    constructor(uint64 _sourceChainSelector, uint256 _flatFee) {
        sourceChainSelector = _sourceChainSelector;
        flatFee = _flatFee;
    }

    function setFlatFee(uint256 newFee) external {
        flatFee = newFee;
    }

    // This matches IRouterClient.getFee selector
    function getFee(uint64, Client.EVM2AnyMessage memory) external view returns (uint256) {
        return flatFee;
    }

    // This matches IRouterClient.ccipSend selector
    function ccipSend(uint64, Client.EVM2AnyMessage calldata message) external returns (bytes32) {
        if (message.feeToken != address(0) && flatFee > 0) {
            IERC20(message.feeToken).transferFrom(msg.sender, address(this), flatFee);
        }

        address receiverAddr = abi.decode(message.receiver, (address));
        bytes32 msgId = keccak256(abi.encodePacked(block.number, msg.sender, receiverAddr, message.data));

        // Only call if receiver is a contract
        if (receiverAddr.code.length > 0) {
            Client.Any2EVMMessage memory delivered = Client.Any2EVMMessage({
                messageId: msgId,
                sourceChainSelector: sourceChainSelector,
                sender: abi.encode(msg.sender),
                data: message.data,
                destTokenAmounts: new Client.EVMTokenAmount[](0)
            });

            ICCIPReceiverLike(receiverAddr).ccipReceive(delivered);
        }

        return msgId;
    }

    // To avoid warnings, optional
    receive() external payable {}

    /*
    Compatibility fallback for alternate tuple ordering used by some Client versions:
    (bytes receiver, bytes data, (address,uint256)[] tokenAmounts, bytes extraArgs, address feeToken)
    */
    fallback() external payable {
        bytes4 sig = msg.sig;

        // getFee(uint64,(bytes,bytes,(address,uint256)[],bytes,address))
        if (sig == 0x84293a74) {
            (
                uint64 destChain,
                bytes memory receiver,
                bytes memory data,
                Client.EVMTokenAmount[] memory tokenAmounts,
                bytes memory extraArgs,
                address feeToken
            ) = abi.decode(msg.data[4:], (uint64, bytes, bytes, Client.EVMTokenAmount[], bytes, address));

            // silence unused
            destChain;
            receiver;
            data;
            tokenAmounts;
            extraArgs;
            feeToken;

            bytes memory ret = abi.encode(flatFee);
            assembly {
                return(add(ret, 32), mload(ret))
            }
        }

        // ccipSend(uint64,(bytes,bytes,(address,uint256)[],bytes,address))
        if (sig == 0x2809f931) {
            (
                uint64 destChain2,
                bytes memory receiver2,
                bytes memory data2,
                Client.EVMTokenAmount[] memory tokenAmounts2,
                bytes memory extraArgs2,
                address feeToken2
            ) = abi.decode(msg.data[4:], (uint64, bytes, bytes, Client.EVMTokenAmount[], bytes, address));

            // silence unused
            destChain2;
            tokenAmounts2;
            extraArgs2;

            if (feeToken2 != address(0) && flatFee > 0) {
                IERC20(feeToken2).transferFrom(msg.sender, address(this), flatFee);
            }

            address receiverAddr2 = abi.decode(receiver2, (address));
            bytes32 msgId2 = keccak256(abi.encodePacked(block.number, msg.sender, receiverAddr2, data2));

            if (receiverAddr2.code.length > 0) {
                Client.Any2EVMMessage memory delivered2 = Client.Any2EVMMessage({
                    messageId: msgId2,
                    sourceChainSelector: sourceChainSelector,
                    sender: abi.encode(msg.sender),
                    data: data2,
                    destTokenAmounts: new Client.EVMTokenAmount[](0)
                });

                ICCIPReceiverLike(receiverAddr2).ccipReceive(delivered2);
            }

            bytes memory ret2 = abi.encode(msgId2);
            assembly {
                return(add(ret2, 32), mload(ret2))
            }
        }

        revert("MockCcipRouter: unknown selector");
    }
}
