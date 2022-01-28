/**
 * wasm register
 * https://github.com/certusone/wormhole/issues/665
 */
import {NodeHttpTransport} from '@improbable-eng/grpc-web-node-http-transport';

import {ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {getDefaultProvider, Wallet} from 'ethers';
import {Connection, clusterApiUrl, Keypair, PublicKey} from '@solana/web3.js';
import getSignedVAAWithRetry, {
    attestFromSolana,
    parseSequenceFromLogSolana,
    getEmitterAddressSolana,
    getSignedVAA,
    CHAIN_ID_SOLANA,
    createWrappedOnEth,
    setDefaultWasm,
    ChainId,
    transferFromSolana,
    CHAIN_ID_ETH,
    hexToUint8Array,
    nativeToHexString,
    getIsTransferCompletedEth, redeemOnEth, getBridgeFeeIx, importCoreWasm,
} from '@certusone/wormhole-sdk';
import {grpc} from '@improbable-eng/grpc-web';

import fs from "fs";
import path from "path";
import os from "os";

setDefaultWasm("node");
grpc.setDefaultTransport(NodeHttpTransport());

const devwalletPrivate = Uint8Array.from([ 85, 253, 228,  82,  24,  11,  44,  49, 141, 181, 157,
    81, 133, 223,  80,  15,  57, 136, 245, 251, 249, 241,
    244, 156,   2,  89, 207,  81,  97, 103, 213,  96,  73,
    139, 193,  87, 174,  28, 133, 250, 218, 176, 145,  48,
    240,  41, 144, 123, 230, 141,  98,  86,  31, 112, 230,
    244, 233,  89,  42,   4,  53,  13, 203,   0
])

let contractAddresses = {
    solanaCoreBridge: '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5',
    solanaTokenBridge: 'DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe',
    ethereumTokenBridge: '0xF890982f9310df57d00f659cf4fd87e65adEd8d7',
}

function loadKeypair(pathname: string): Keypair {
    // const keypairBuffer = fs.readFileSync(pathname, {});
    // const keypairArray = JSON.parse(keypairBuffer.toString('utf-8'))
    // return Keypair.fromSecretKey(Uint8Array.from(keypairArray));
    return Keypair.fromSecretKey(devwalletPrivate)
}


function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryGetSignedVAA(host: string, emitterChain: ChainId, emitterAddress: string, sequence: string): Promise<Uint8Array> {
    let result: Awaited<ReturnType<typeof getSignedVAA>> | null = null;
    let retriedTime = 0;
    while (!result?.vaaBytes) {
        if (retriedTime > 10) {
            throw new Error('retryGetSignedVAA failed');
        }
        try {
            console.log('retry for signed VAA', retriedTime);
            result = await getSignedVAA(host, emitterChain, emitterAddress, sequence);
        } catch (e) {
            if (e.code !== 5) {
                throw e;
            }
            console.log('retryGetSignedVAA failed', e.code);
        }
        await sleep(1000);
        retriedTime++;
    }

    return result.vaaBytes;
}

(async function begin() {

    const sourceWalletKeypairPath = path.resolve(os.homedir(), ".config/solana/id.json");
    let sourceAddress = loadKeypair(sourceWalletKeypairPath);
    const payerAddress = sourceAddress.publicKey.toString();
    let connection = new Connection(clusterApiUrl('devnet'), {
        commitment: 'confirmed',
    });
    const mintAddress = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
    const WORMHOLE_RPC_HOSTS = "https://wormhole-v2-testnet-api.certus.one";

        let result = await attestFromSolana(
        connection,
        contractAddresses.solanaCoreBridge,
        contractAddresses.solanaTokenBridge,
        sourceAddress.publicKey.toString(),
        "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
    );

        // how to get bridge state address
    const bridge = await importCoreWasm();
    const bridgeFeeAccount = await bridge.fee_collector_address(contractAddresses.solanaCoreBridge);
    const bridgeStateAddress = new PublicKey(bridge.state_address(contractAddresses.solanaCoreBridge));
    console.log(bridgeStateAddress.toString());
    console.log(new PublicKey(bridgeFeeAccount).toString());

    // const bridgeFeeIx = await getBridgeFeeIx(connection, contractAddresses.solanaCoreBridge, payerAddress);
    // console.log(bridgeFeeIx.keys[0].pubkey.toString());

    result.partialSign(sourceAddress);
    const txresult = await connection.sendRawTransaction(result.serialize());
    await connection.confirmTransaction(txresult, 'confirmed');
    const txinfo = await connection.getTransaction(txresult);
    const sequence = parseSequenceFromLogSolana(txinfo);
    const emitterAddress = await getEmitterAddressSolana(contractAddresses.solanaTokenBridge);
    // const vaaBytes = await retryGetSignedVAA(
    //     WORMHOLE_RPC_HOSTS,
    //     CHAIN_ID_SOLANA,
    //     emitterAddress,
    //     sequence,
    // );

    console.log('vaa confirmed!')
    let ethGoerli = getDefaultProvider('goerli');
    const ethSigner = new Wallet("fb39abdd1d9a0766a17a020213d762c9f829f83ef543a717661ccf0f26582bce", ethGoerli);

    console.log('confirm the attestation on eth')
    // const contractReceipt = await createWrappedOnEth(contractAddresses.ethereumTokenBridge, ethSigner, vaaBytes);
    //
    // console.log('txresult', txresult);
    // console.log('eth receipt', contractReceipt);


    console.log('start transfer from solana')
    const targetAddress = await ethSigner.getAddress();
    const dd = hexToUint8Array(nativeToHexString(targetAddress, CHAIN_ID_ETH));
    console.log('target address', dd);
    const fromAddress = (
        await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            new PublicKey(mintAddress),
            sourceAddress.publicKey
        )
    ).toString();

    const transferTransaction = await transferFromSolana(
        connection,
        contractAddresses.solanaCoreBridge,
        contractAddresses.solanaTokenBridge,
        sourceAddress.publicKey.toString(),
        fromAddress,
        mintAddress,
        BigInt(10000),
        hexToUint8Array(nativeToHexString(targetAddress, CHAIN_ID_ETH)),
        CHAIN_ID_ETH,
    );

    // transferTransaction.partialSign(sourceAddress);
    // const transferTxId = await connection.sendRawTransaction(transferTransaction.serialize());
    // await connection.confirmTransaction(transferTxId, 'confirmed');
    // const transferTxIdInfo = await connection.getTransaction(transferTxId);
    // if (!transferTxIdInfo) {
    //     throw new Error('transferTxIdInfo is null');
    // }

    // const transferTxSequence = parseSequenceFromLogSolana(transferTxIdInfo);
    const signedVAA = await retryGetSignedVAA(
       WORMHOLE_RPC_HOSTS,
        CHAIN_ID_SOLANA,
        emitterAddress,
        '540',
    );
    const isComplete = await getIsTransferCompletedEth(
        contractAddresses.ethereumTokenBridge,
        ethGoerli,
        signedVAA,
    )
    console.log('transfer complete?', isComplete);

    // let redeem
    const transferContractReceipt = await redeemOnEth(contractAddresses.ethereumTokenBridge, ethSigner, signedVAA);
    console.log('transferTransactionTxId', '2RRZgcTFzGd7bNbxVr2amGGqweVDNh3jdYAHFjEKgETSvA4HHMYVmABw7t2KMcVQ1kaXN3uZsMeE6K6mbBvjD8Dp');
    console.log('transferContractReceipt', transferContractReceipt);


})();
