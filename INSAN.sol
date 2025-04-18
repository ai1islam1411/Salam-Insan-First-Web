// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract InsanToken is ERC20, Ownable {
    uint256 private constant TOTAL_SUPPLY = 10_000_000_000 * 10**18; // 10 billion
    
    mapping(address => bool) private _minters;
    
    constructor() ERC20("Insan Token", "INSAN") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
    
    function addMinter(address account) external onlyOwner {
        _minters[account] = true;
    }
    
    function removeMinter(address account) external onlyOwner {
        _minters[account] = false;
    }
    
    function mint(address to, uint256 amount) external {
        require(_minters[msg.sender], "InsanToken: caller is not a minter");
        _mint(to, amount);
    }
    
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
