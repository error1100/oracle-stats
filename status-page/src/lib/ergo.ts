import * as ergo from 'ergo-lib-wasm-browser';
import { NETWORK_PREFIX } from '../config';

export const decodeI32Register = (serializedValue: string): number => {
  const constant = ergo.Constant.decode_from_base16(serializedValue);
  const value = constant.to_i32();
  constant.free();
  return value;
};

export const decodeI64Register = (serializedValue: string): number => {
  const constant = ergo.Constant.decode_from_base16(serializedValue);
  const i64 = constant.to_i64();
  const value = i64.as_num();
  i64.free();
  constant.free();
  return value;
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const decodeOraclePublicKey = (serializedValue: string) => {
  const constant = ergo.Constant.decode_from_base16(serializedValue);
  const sigmaBytes = constant.sigma_serialize_bytes();
  constant.free();
  if (!sigmaBytes.length || sigmaBytes[0] !== 0x07) {
    throw new Error('Unexpected oracle public key register format');
  }
  const pkBytes = sigmaBytes.slice(1);
  const address = ergo.Address.p2pk_from_pk_bytes(pkBytes);
  const publicKeyHex = toHex(pkBytes);
  const base58 = address.to_base58(NETWORK_PREFIX);
  address.free();
  return { publicKeyHex, base58 };
};
