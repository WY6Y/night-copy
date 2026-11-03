//! Morse table and Koch order.

/// LCWO Koch order. The game unlocks characters from the front.
pub const KOCH: &[u8] = b"KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X";

const TABLE: &[(u8, &str)] = &[
    (b'A', ".-"), (b'B', "-..."), (b'C', "-.-."), (b'D', "-.."), (b'E', "."),
    (b'F', "..-."), (b'G', "--."), (b'H', "...."), (b'I', ".."), (b'J', ".---"),
    (b'K', "-.-"), (b'L', ".-.."), (b'M', "--"), (b'N', "-."), (b'O', "---"),
    (b'P', ".--."), (b'Q', "--.-"), (b'R', ".-."), (b'S', "..."), (b'T', "-"),
    (b'U', "..-"), (b'V', "...-"), (b'W', ".--"), (b'X', "-..-"), (b'Y', "-.--"),
    (b'Z', "--.."),
    (b'0', "-----"), (b'1', ".----"), (b'2', "..---"), (b'3', "...--"), (b'4', "....-"),
    (b'5', "....."), (b'6', "-...."), (b'7', "--..."), (b'8', "---.."), (b'9', "----."),
    (b'.', ".-.-.-"), (b',', "--..--"), (b'?', "..--.."), (b'/', "-..-."), (b'=', "-...-"),
    (b'+', ".-.-."), (b'-', "-....-"), (b'\'', ".----."), (b'(', "-.--."), (b')', "-.--.-"),
    (b':', "---..."), (b';', "-.-.-."), (b'"', ".-..-."), (b'@', ".--.-."), (b'!', "-.-.--"),
    (b'&', ".-..."),
];

pub fn code(c: u8) -> Option<&'static str> {
    let c = c.to_ascii_uppercase();
    TABLE.iter().find(|(k, _)| *k == c).map(|(_, v)| *v)
}

pub fn lookup(pattern: &str) -> Option<u8> {
    TABLE.iter().find(|(_, v)| *v == pattern).map(|(k, _)| *k)
}

/// Parse text into characters, each a list of elements (true = dah), with
/// `None` marking a word gap. `<AR>`-style prosigns become one character.
pub fn parse(text: &[u8]) -> Vec<Option<(Vec<u8>, Vec<bool>)>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        if c == b' ' || c == b'\n' {
            if !matches!(out.last(), Some(None) | None) {
                out.push(None);
            }
            i += 1;
        } else if c == b'<' {
            let end = text[i..].iter().position(|&b| b == b'>').map(|p| i + p);
            let Some(end) = end else { i += 1; continue };
            let mut els = Vec::new();
            for &p in &text[i + 1..end] {
                if let Some(cd) = code(p) {
                    els.extend(cd.bytes().map(|b| b == b'-'));
                }
            }
            if !els.is_empty() {
                out.push(Some((text[i..=end].to_vec(), els)));
            }
            i = end + 1;
        } else {
            if let Some(cd) = code(c) {
                out.push(Some((vec![c.to_ascii_uppercase()], cd.bytes().map(|b| b == b'-').collect())));
            }
            i += 1;
        }
    }
    while matches!(out.last(), Some(None)) {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn koch_chars_all_have_codes() {
        for &c in KOCH {
            assert!(code(c).is_some(), "missing code for {}", c as char);
        }
        assert_eq!(KOCH.len(), 41);
    }

    #[test]
    fn parse_prosign_and_words() {
        let p = parse(b"cq <AR>  k");
        assert_eq!(p.len(), 6); // C Q _ <AR> _ K
        assert!(p[2].is_none());
        assert_eq!(p[3].as_ref().unwrap().1, vec![false, true, false, true, false]);
    }
}
