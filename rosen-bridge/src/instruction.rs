use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub enum Waypoint {
    OrcaWormholeTerraUST,
    WormholeBinanceWsUSDC,
    WormholeEthereumWsUSDC,
}

#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct SendArgs {
    pub destination_address: [u8; 32],
    pub transfer_nonce: u32,
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct PrepareArgs {
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
pub enum RosenBridgeInstruction {
    Prepare(PrepareArgs),
    Send(SendArgs),
}
