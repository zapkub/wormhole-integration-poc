use num_derive::FromPrimitive;
use solana_program::{
    decode_error::DecodeError,
    msg,
    program_error::{PrintProgramError, ProgramError},
};
use thiserror::Error;

/// Errors that may be returned by the Metadata program.
#[derive(Clone, Debug, Eq, Error, FromPrimitive, PartialEq)]
pub enum MetadataError {
    #[error("Failed to unpack instruction data")]
    UnknownError,
}

impl PrintProgramError for MetadataError {
    fn print<E>(&self) {
        msg!(&self.to_string());
    }
}

impl<T> DecodeError<T> for MetadataError {
    fn type_of() -> &'static str {
        "Metadata Error"
    }
}
