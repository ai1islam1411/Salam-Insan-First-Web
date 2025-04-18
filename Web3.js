const Web3 = require('web3');
const InsanTokenABI = require('./InsanTokenABI.json');

const web3 = new Web3(process.env.BLOCKCHAIN_NODE_URL);
const insanToken = new web3.eth.Contract(
    InsanTokenABI,
    process.env.TOKEN_CONTRACT_ADDRESS
);

class BlockchainService {
    constructor() {
        this.adminAccount = web3.eth.accounts.privateKeyToAccount(
            process.env.ADMIN_PRIVATE_KEY
        );
        web3.eth.accounts.wallet.add(this.adminAccount);
    }
    
    async getBalance(address) {
        return await insanToken.methods.balanceOf(address).call();
    }
    
    async transfer(fromAddress, toAddress, amount, privateKey) {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        web3.eth.accounts.wallet.add(account);
        
        const tx = {
            from: fromAddress,
            to: process.env.TOKEN_CONTRACT_ADDRESS,
            gas: 200000,
            data: insanToken.methods.transfer(toAddress, amount).encodeABI()
        };
        
        const receipt = await web3.eth.sendTransaction(tx);
        return receipt.transactionHash;
    }
    
    async mintTokens(toAddress, amount) {
        const tx = {
            from: this.adminAccount.address,
            to: process.env.TOKEN_CONTRACT_ADDRESS,
            gas: 200000,
            data: insanToken.methods.mint(toAddress, amount).encodeABI()
        };
        
        const receipt = await web3.eth.sendTransaction(tx);
        return receipt.transactionHash;
    }
}

module.exports = new BlockchainService();
