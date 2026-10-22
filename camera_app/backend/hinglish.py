"""Devanagari -> Hinglish (Roman) transliteration for Whisper transcripts.

Whisper hears factory Hindi best with language='hi' (Devanagari output); asking it for English or
Roman text loses words or changes the meaning. This keeps exactly what Whisper heard and only
changes the script, so operators can read e.g. "ये फीडोर सिग्नल प्रोब्लम" as "ye fidor signal problam".

Simple, readable spelling (the way people type Hinglish): long vowels are not doubled, the
inherent 'a' is dropped at word end and in the usual medial positions (कमला -> kamla).
"""
from __future__ import annotations

VOWELS = {
    'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai',
    'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e',
}
MATRAS = {
    'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
    'ॉ': 'o', 'ॅ': 'e',
}
CONSONANTS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
    'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
}
NUKTA = '़'
VIRAMA = '्'
MARKS = {'ं': 'n', 'ँ': 'n', 'ः': 'h'}
DIGITS = {chr(0x0966 + i): str(i) for i in range(10)}
PUNCT = {'।': '.', '॥': '.'}


def _tokens(word: str) -> list[tuple[str, str]]:
    """Split a word into (kind, roman) units: kind is 'C' (consonant + inherent a), 'c' (bare
    consonant), 'V' (vowel/matra) or 'M' (nasal/visarga mark)."""
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(word):
        ch = word[i]
        if i + 1 < len(word) and word[i + 1] == NUKTA and ch + NUKTA in CONSONANTS:
            ch, i = ch + NUKTA, i + 1
        if ch in CONSONANTS:
            nxt = word[i + 1] if i + 1 < len(word) else ''
            if nxt == VIRAMA:
                out.append(('c', CONSONANTS[ch])); i += 2; continue
            if nxt in MATRAS:
                out.append(('c', CONSONANTS[ch])); out.append(('V', MATRAS[nxt])); i += 2; continue
            out.append(('C', CONSONANTS[ch]))
        elif ch in VOWELS:
            out.append(('V', VOWELS[ch]))
        elif ch in MARKS:
            out.append(('M', MARKS[ch]))
        elif ch in DIGITS:
            out.append(('V', DIGITS[ch]))
        elif ch in PUNCT:
            out.append(('V', PUNCT[ch]))
        elif ch not in (VIRAMA, NUKTA):
            out.append(('V', ch))
        i += 1
    return out


def _word(word: str) -> str:
    t = _tokens(word)
    n = len(t)
    roman = []
    for idx, (kind, text) in enumerate(t):
        if kind != 'C':
            roman.append(text)
            continue
        is_last = idx == n - 1 or all(k == 'M' for k, _ in t[idx + 1:])
        prev_is_vowelish = idx > 0 and t[idx - 1][0] in ('V', 'C')
        next_is_consonant_with_vowel = (
            idx + 2 < n and t[idx + 1][0] == 'c' and t[idx + 2][0] == 'V'
        ) or (idx + 1 < n and t[idx + 1][0] == 'C' and idx + 1 != n - 1)
        if is_last and n > 1:
            roman.append(text)                      # final schwa deletion: कम -> kam
        elif prev_is_vowelish and next_is_consonant_with_vowel and idx > 0:
            roman.append(text)                      # medial schwa deletion: कमला -> kamla
        else:
            roman.append(text + 'a')
    return ''.join(roman)


# Exact Devanagari spellings of English shop-floor words -> normal English spelling. Only words
# Whisper actually wrote are replaced (whole-word match); nothing is added or guessed.
ENGLISH_WORDS = {
    'मशीन': 'machine', 'मसीन': 'machine', 'ब्रेकडाउन': 'breakdown', 'ब्रेक': 'break',
    'प्रॉब्लम': 'problem', 'प्रोब्लम': 'problem', 'प्रॉब्लेम': 'problem', 'प्रोब्लेम': 'problem', 'प्राब्लम': 'problem',
    'मेंटेनेंस': 'maintenance', 'मेंटेनन्स': 'maintenance', 'हाइड्रोलिक': 'hydraulic', 'प्रेशर': 'pressure',
    'डाई': 'die', 'चेंज': 'change', 'सिग्नल': 'signal', 'प्लंजर': 'plunger', 'इजेक्टर': 'ejector',
    'मोल्ड': 'mould', 'लीकेज': 'leakage', 'कास्टिंग': 'casting', 'टूल': 'tool', 'ऑपरेटर': 'operator',
    'स्टॉपेज': 'stoppage', 'ब्रोकन': 'broken', 'रनर': 'runner', 'सेफ्टी': 'safety', 'डोर': 'door',
    'गेट': 'gate', 'स्विच': 'switch', 'मोटर': 'motor', 'सेंसर': 'sensor', 'टेम्परेचर': 'temperature',
    'पंप': 'pump', 'वाल्व': 'valve', 'शिफ्ट': 'shift', 'लाइन': 'line', 'पावर': 'power', 'एरर': 'error',
    'अलार्म': 'alarm', 'सिलेंडर': 'cylinder', 'नोजल': 'nozzle', 'फीडर': 'feeder', 'कूलिंग': 'cooling',
    'वाटर': 'water', 'ऑयल': 'oil', 'स्टार्ट': 'start', 'स्टॉप': 'stop', 'रिसेट': 'reset', 'पार्ट': 'part',
}


def devanagari_to_hinglish(text: str | None) -> str | None:
    if not text:
        return text
    if not any('ऀ' <= ch <= 'ॿ' for ch in text):
        return text
    words = []
    for word in text.split():
        core = word.strip('।॥.,!?')
        tail = word[len(core):] if word.startswith(core) else ''
        if core in ENGLISH_WORDS:
            words.append(ENGLISH_WORDS[core] + tail.replace('।', '.').replace('॥', '.'))
        else:
            words.append(_word(word))
    out = ' '.join(words)
    return out[:1].upper() + out[1:] if out else out
