// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { FinalizationL2 } from "../l2/FinalizationL2.sol";

contract FinalizationHarness is FinalizationL2 {
    struct PollCfg {
        bool exists;
        uint64 endTime;
        uint256 optionsLen;
        bool quorumEnabled;
        uint16 quorumBps;
        bool eligibleSupported;
        uint256 eligibleCount;
        uint8 forcedRaw; // 0..255
    }

    mapping(uint256 => PollCfg) internal _poll;
    mapping(uint256 => mapping(uint256 => uint256)) internal _votes;

    function setPoll(
        uint256 pollId,
        bool exists_,
        uint64 endTime_,
        uint256 optionsLen_,
        bool quorumEnabled_,
        uint16 quorumBps_
    ) external {
        _poll[pollId].exists = exists_;
        _poll[pollId].endTime = endTime_;
        _poll[pollId].optionsLen = optionsLen_;
        _poll[pollId].quorumEnabled = quorumEnabled_;
        _poll[pollId].quorumBps = quorumBps_;
    }

    function setEligible(uint256 pollId, bool supported, uint256 eligibleCount) external {
        _poll[pollId].eligibleSupported = supported;
        _poll[pollId].eligibleCount = eligibleCount;
    }

    function setVote(uint256 pollId, uint256 optionIndex, uint256 count) external {
        _votes[pollId][optionIndex] = count;
    }

    function setForcedRaw(uint256 pollId, uint8 raw) external {
        _poll[pollId].forcedRaw = raw;
    }

    function _pollExists(uint256 pollId) internal view override returns (bool) {
        return _poll[pollId].exists;
    }

    function _pollEndTime(uint256 pollId) internal view override returns (uint64) {
        return _poll[pollId].endTime;
    }

    function _pollOptionsLength(uint256 pollId) internal view override returns (uint256) {
        return _poll[pollId].optionsLen;
    }

    function _pollQuorum(uint256 pollId) internal view override returns (bool enabled, uint16 quorumBps) {
        PollCfg storage p = _poll[pollId];
        return (p.quorumEnabled, p.quorumBps);
    }

    function _voteCount(uint256 pollId, uint256 optionIndex) internal view override returns (uint256) {
        return _votes[pollId][optionIndex];
    }

    function _eligibleCountForQuorum(uint256 pollId)
        internal
        view
        override
        returns (bool supported, uint256 eligibleCount)
    {
        PollCfg storage p = _poll[pollId];
        return (p.eligibleSupported, p.eligibleCount);
    }

    // IMPORTANT: do NOT use `return(...)` opcode here, because it exits finalizePollOnL2 entirely.
    function _finalStatusForFinalize(uint256 pollId)
        internal
        view
        override
        returns (ResultStatus st)
    {
        uint8 raw = _poll[pollId].forcedRaw;
        assembly {
            st := raw
        }
    }
}
