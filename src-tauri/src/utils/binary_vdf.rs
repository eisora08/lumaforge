//! Binary VDF (Valve Data Format) serializer.
//!
//! Encodes a nested key-value tree into the binary format used by Steam's
//! `UserGameStatsSchema_*.bin` files and other Valve binary data stores.
//!
//! Wire format:
//!   0x00 = Object  (null-terminated key + children + 0x08 terminator)
//!   0x01 = String  (null-terminated key + null-terminated value)
//!   0x02 = Int32   (null-terminated key + 4 bytes LE)
//!   0x03 = Float32 (null-terminated key + 4 bytes LE)
//!   0x07 = UInt64  (null-terminated key + 8 bytes LE)
//!   0x08 = End     (no payload — closes parent object)

#![allow(dead_code)] // Float variant + constructors used in tests / reserved for future Binary VDF types

// ─── Type Tags ──────────────────────────────────────────────────────────────

const BIN_NONE: u8 = 0x00; // Object/container
const BIN_STRING: u8 = 0x01;
const BIN_INT32: u8 = 0x02;
const BIN_FLOAT: u8 = 0x03;
const BIN_UINT64: u8 = 0x07;
const BIN_END: u8 = 0x08;

// ─── Value Type ─────────────────────────────────────────────────────────────

/// A Binary VDF value. Objects use a `Vec` of (key, value) pairs to preserve
/// insertion order (matching the Python `vdf` library's dict behavior).
#[derive(Debug, Clone, PartialEq)]
pub enum VdfValue {
    /// Container/object — `0x00` + key + children + `0x08`
    Object(Vec<(String, VdfValue)>),
    /// UTF-8 string — `0x01` + key + value
    Str(String),
    /// Signed 32-bit integer — `0x02` + key + 4 LE bytes
    Int32(i32),
    /// IEEE 754 float — `0x03` + key + 4 LE bytes
    Float(f32),
    /// Unsigned 64-bit integer — `0x07` + key + 8 LE bytes
    UInt64(u64),
}

// Convenience constructors
impl VdfValue {
    pub fn obj(entries: Vec<(String, VdfValue)>) -> Self {
        VdfValue::Object(entries)
    }

    pub fn str(s: impl Into<String>) -> Self {
        VdfValue::Str(s.into())
    }

    pub fn int(v: i32) -> Self {
        VdfValue::Int32(v)
    }

    pub fn uint64(v: u64) -> Self {
        VdfValue::UInt64(v)
    }
}

// ─── Serializer ─────────────────────────────────────────────────────────────

/// Serialize a list of top-level key-value entries into Binary VDF bytes.
///
/// The result starts directly with KV entries (no header/magic), matching the
/// format expected by `UserGameStatsSchema_*.bin`.
pub fn write_binary_vdf(entries: &[(String, VdfValue)]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(256);
    write_entries(entries, &mut buf);
    buf
}

/// Write a list of KV entries (each preceded by its type tag).
fn write_entries(entries: &[(String, VdfValue)], buf: &mut Vec<u8>) {
    for (key, value) in entries {
        write_kv(key, value, buf);
    }
}

/// Write a single key-value pair with its type tag.
fn write_kv(key: &str, value: &VdfValue, buf: &mut Vec<u8>) {
    match value {
        VdfValue::Object(children) => {
            buf.push(BIN_NONE);
            write_key(key, buf);
            write_entries(children, buf);
            buf.push(BIN_END);
        }
        VdfValue::Str(s) => {
            buf.push(BIN_STRING);
            write_key(key, buf);
            write_cstring(s, buf);
        }
        VdfValue::Int32(v) => {
            buf.push(BIN_INT32);
            write_key(key, buf);
            buf.extend_from_slice(&v.to_le_bytes());
        }
        VdfValue::Float(v) => {
            buf.push(BIN_FLOAT);
            write_key(key, buf);
            buf.extend_from_slice(&v.to_le_bytes());
        }
        VdfValue::UInt64(v) => {
            buf.push(BIN_UINT64);
            write_key(key, buf);
            buf.extend_from_slice(&v.to_le_bytes());
        }
    }
}

/// Write a null-terminated UTF-8 key.
fn write_key(key: &str, buf: &mut Vec<u8>) {
    buf.extend_from_slice(key.as_bytes());
    buf.push(0x00);
}

/// Write a null-terminated UTF-8 string value.
fn write_cstring(s: &str, buf: &mut Vec<u8>) {
    buf.extend_from_slice(s.as_bytes());
    buf.push(0x00);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_entries_produces_empty_buffer() {
        let result = write_binary_vdf(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn single_string_kv() {
        let result = write_binary_vdf(&[("name".into(), VdfValue::Str("test".into()))]);
        // BIN_STRING(0x01) + "name\0" + "test\0"
        assert_eq!(
            result,
            vec![0x01, b'n', b'a', b'm', b'e', 0x00, b't', b'e', b's', b't', 0x00]
        );
    }

    #[test]
    fn single_int32_kv() {
        let result = write_binary_vdf(&[("count".into(), VdfValue::Int32(42))]);
        // BIN_INT32(0x02) + "count\0" + 42i32 LE
        assert_eq!(result[0], 0x02);
        assert_eq!(&result[1..7], b"count\0");
        assert_eq!(&result[7..11], &42i32.to_le_bytes());
    }

    #[test]
    fn nested_object() {
        let result = write_binary_vdf(&[(
            "root".into(),
            VdfValue::Object(vec![("key".into(), VdfValue::Str("val".into()))]),
        )]);
        // BIN_NONE(0x00) + "root\0" + BIN_STRING(0x01) + "key\0" + "val\0" + BIN_END(0x08)
        assert_eq!(result[0], 0x00); // Object
        assert_eq!(&result[1..6], b"root\0");
        assert_eq!(result[6], 0x01); // String child
        assert_eq!(&result[7..11], b"key\0");
        assert_eq!(&result[11..15], b"val\0");
        assert_eq!(result[15], 0x08); // End
    }

    #[test]
    fn deeply_nested_objects() {
        let result = write_binary_vdf(&[(
            "a".into(),
            VdfValue::Object(vec![(
                "b".into(),
                VdfValue::Object(vec![("c".into(), VdfValue::Int32(1))]),
            )]),
        )]);
        // Layout: 0x00 "a\0" 0x00 "b\0" 0x02 "c\0" {1i32} 0x08 0x08
        assert_eq!(result[0], 0x00); // a obj
        assert_eq!(&result[1..3], b"a\0");
        assert_eq!(result[3], 0x00); // b obj
        assert_eq!(&result[4..6], b"b\0");
        assert_eq!(result[6], 0x02); // c int
        assert_eq!(&result[7..9], b"c\0");
        assert_eq!(&result[9..13], &1i32.to_le_bytes());
        assert_eq!(result[13], 0x08); // end b
        assert_eq!(result[14], 0x08); // end a
    }

    #[test]
    fn uint64_kv() {
        let result = write_binary_vdf(&[("id".into(), VdfValue::UInt64(0xDEADBEEFCAFEBABE))]);
        assert_eq!(result[0], 0x07); // BIN_UINT64
        assert_eq!(&result[1..4], b"id\0");
        assert_eq!(&result[4..12], &0xDEADBEEFCAFEBABE_u64.to_le_bytes());
    }

    #[test]
    fn float_kv() {
        let result = write_binary_vdf(&[("ratio".into(), VdfValue::Float(0.75))]);
        assert_eq!(result[0], 0x03); // BIN_FLOAT
        assert_eq!(&result[1..7], b"ratio\0");
        let float_bytes = f32::to_le_bytes(0.75);
        assert_eq!(&result[7..11], &float_bytes);
    }

    #[test]
    fn empty_string_value() {
        let result = write_binary_vdf(&[("desc".into(), VdfValue::Str("".into()))]);
        assert_eq!(result, vec![0x01, b'd', b'e', b's', b'c', 0x00, 0x00]);
    }

    #[test]
    fn empty_object_children() {
        let result = write_binary_vdf(&[("empty".into(), VdfValue::Object(vec![]))]);
        assert_eq!(result, vec![0x00, b'e', b'm', b'p', b't', b'y', 0x00, 0x08]);
    }

    #[test]
    fn multiple_entries_ordering() {
        let result = write_binary_vdf(&[
            ("b".into(), VdfValue::Int32(2)),
            ("a".into(), VdfValue::Int32(1)),
        ]);
        // b comes first (insertion order preserved)
        assert_eq!(result[0], 0x02); // int32
        assert_eq!(&result[1..3], b"b\0");
        assert_eq!(result[7], 0x02); // int32
        assert_eq!(&result[8..10], b"a\0");
    }

    #[test]
    fn schema_like_structure() {
        // Minimal schema structure matching GSE format
        let schema = write_binary_vdf(&[(
            "480".into(),
            VdfValue::Object(vec![
                ("gamename".into(), VdfValue::Str("Test Game".into())),
                ("version".into(), VdfValue::Str("1".into())),
                ("stats".into(), VdfValue::Object(vec![(
                    "1".into(),
                    VdfValue::Object(vec![
                        ("type".into(), VdfValue::Str("4".into())),
                        ("id".into(), VdfValue::Str("1".into())),
                        ("bits".into(), VdfValue::Object(vec![(
                            "0".into(),
                            VdfValue::Object(vec![
                                ("name".into(), VdfValue::Str("TEST_ACH".into())),
                                ("bit".into(), VdfValue::Int32(0)),
                                ("display".into(), VdfValue::Object(vec![
                                    ("name".into(), VdfValue::Str("Test Achievement".into())),
                                    ("desc".into(), VdfValue::Str("A test".into())),
                                    ("hidden".into(), VdfValue::Str("0".into())),
                                ])),
                            ]),
                        )])),
                    ]),
                )])),
            ]),
        )]);

        // Verify structure starts with root object tag
        assert_eq!(schema[0], 0x00);
        // Verify it contains recognizable strings
        let text = String::from_utf8_lossy(&schema);
        assert!(text.contains("480"));
        assert!(text.contains("gamename"));
        assert!(text.contains("Test Game"));
        assert!(text.contains("TEST_ACH"));
        // Verify it ends with end tag
        assert_eq!(*schema.last().unwrap(), 0x08);
    }
}
