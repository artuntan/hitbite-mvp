// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Phase 0 placeholder: proves the toolchain and OpenZeppelin remapping work. Replaced in Phase 1.
contract ScaffoldTest is Test {
    function test_openZeppelinRemappingResolves() public pure {
        assertEq(type(IERC20).interfaceId, type(IERC20).interfaceId);
    }
}
