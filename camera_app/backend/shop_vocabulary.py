"""Snap mis-heard shop-floor terms in a Roman (Hinglish) transcript to their correct spelling.

Whisper hears short factory phrases like "die polish" or "power cut" as "Gay polis" / "Povar kat":
the sound is right, the spelling is not. This compares the transcript to a vocabulary of shop
terms by sound (vowels and similar consonants folded together) and replaces close matches.
Only phrases of a few sounds or more are replaced, and only when they sound very close, so
ordinary Hindi words ("par", "hai", "band") are left alone.
"""
from __future__ import annotations

import re
from functools import lru_cache
from difflib import SequenceMatcher

# Terms operators say when reporting a stoppage. Extend per plant with TRANSCRIPTION_VOCABULARY.
DEFAULT_TERMS = (
    'die polish', 'die change', 'die breakdown', 'die cleaning', 'die setting', 'die crack', 'die heating',
    'power cut', 'power failure', 'runner broken', 'feeder signal problem', 'signal problem',
    'machine breakdown', 'robot breakdown', 'hydraulic', 'pressure', 'plunger', 'ejector', 'ejector pin',
    'shot sleeve', 'ladle', 'spray', 'oil leakage', 'water leakage', 'cooling', 'furnace', 'metal',
    'material', 'casting', 'trimming', 'sensor', 'motor', 'pump', 'heater', 'temperature', 'maintenance',
    'electrical', 'mechanical', 'breakdown', 'quality', 'trial', 'setting', 'cleaning', 'polish',
    'runner', 'broken', 'feeder', 'signal', 'problem', 'machine', 'robot', 'conveyor', 'insert', 'core',
    'jam', 'stuck', 'leakage', 'manpower', 'operator', 'mould',
    'metal temperature low', 'metal temperature high', 'temperature low', 'temperature high',
    'pressure low', 'pressure high', 'oil temperature high', 'water temperature high', 'metal low',
    'oil level low', 'water level low', 'air pressure low',
    'flash', 'die flash', 'flash check', 'die check', 'check',
    'biscuit', 'auto spray', 'spray check', 'extractor', 'punch',
)

# Everyday Hindi words: a window containing one of these is only replaced when the term itself
# contains that exact word, so "kal aaunga" or "break hai" never turn into shop terms.
HINDI_WORDS = frozenset('''
hai hain ho hoga tha the thi ki ka ke ko se me mein men main mai par pe aur ya nahi nahin na bhi to
hi ab abhi kal aaj hum ham ye yah yeh wo woh vo kya kyu kyon kar karo karna karne kiya raha rahi rahe
gaya gayi gaye hua hui hue band chalu wajah vajah liye lie sab kuch ek do teen haan ha ji bhai sir
kam zyada jyada thoda bahut baad pehle pahle phir fir wala wali wale isme usme iska uska apna kai log
'''.split())

MIN_SOUND_LENGTH = 5      # shorter phrases ("die", "jam") are never replaced on sound alone
MIN_SIMILARITY = 0.84
MAX_WINDOW_WORDS = 4

_DIGRAPHS = (('ph', 'f'), ('sh', 's'), ('kh', 'k'), ('gh', 'g'), ('th', 't'), ('dh', 'd'), ('bh', 'b'),
             ('jh', 'j'), ('ck', 'k'), ('ch', '#'), ('c', 'k'), ('#', 'c'), ('q', 'k'), ('x', 'ks'),
             ('z', 'j'), ('v', 'w'), ('ge', 'je'), ('gi', 'ji'))   # soft g: change = chenj
_VOWELS = re.compile(r'[aeiouy]+')
_REPEATS = re.compile(r'(.)\1+')


def sound_key(text: str) -> str:
    """Rough pronunciation key: 'Povar kat' and 'power cut' both become 'pawarkat'."""
    s = re.sub(r'(?<=[aeiou])w\b', '', text.lower())   # silent final w: low = lo
    s = re.sub(r'[^a-z]', '', s)
    for src, dst in _DIGRAPHS:
        s = s.replace(src, dst)
    s = _VOWELS.sub('a', s)
    s = re.sub(r'(?<=[^a])h', '', s)   # aspiration after a consonant
    return _REPEATS.sub(r'\1', s)


def parse_terms(extra: str | None = None) -> list[str]:
    terms = list(DEFAULT_TERMS)
    for term in (extra or '').split(','):
        term = ' '.join(term.split())
        if term and term.lower() not in {t.lower() for t in terms}:
            terms.append(term)
    return terms


@lru_cache(maxsize=8)
def _keyed_terms(terms: tuple[str, ...]):
    return [(term, sound_key(term)) for term in terms if len(sound_key(term)) >= MIN_SOUND_LENGTH]


def _edge_word_spare(tokens, span, term_key, score):
    """True when the first or last heard word adds nothing ("ejector pin tut" vs "ejector pin",
    "presar lo" vs "pressure"): the term matches about as well without it."""
    longer = len(sound_key(' '.join(tokens[i] for i in span))) > len(term_key)
    for part in (span[1:], span[:-1]):
        key = sound_key(' '.join(tokens[i] for i in part))
        if SequenceMatcher(None, key, term_key).ratio() >= score - (0.03 if longer else 0):
            return True
    return False


# Exact mis-hearings seen in this plant's recordings (Bawal, Oct 2026), fixed before the
# sound-alike pass. "Jai/Gai/Kai fles" is how Whisper writes "die flash".
ALIASES = {
    'die flash': ('jai fles', 'gai fles', 'kai fles', 'dai fles', 'day fles', 'die fles',
                  'jai flash', 'gai flash', 'kai flash', 'dai flash', 'day flash', 'jai flais', 'gai flais'),
    'flash': ('fles', 'flais'),
    'runner tut': ('ran aur tut', 'runner thut', 'runner tud', 'ranar tut', 'ranar thut', 'rana sut', 'rana tut', 'ranar sut'),
    'runner': ('ranar', 'runar', 'raanaar'),
    'flash marne': ('ples marne', 'fles marne'),
    'ki wajah se': ('ki bajay se', 'ki baze se', 'ki bajah se', 'ki bajsi se', 'ki baje se', 'ki wajay se'),
    'biscuit': ('bisket', 'biskit', 'biscut', 'biskut'),
    'auto spray': ('aur to saprej', 'auto saprej', 'aato spray', 'auto spre'),
    'spray': ('saprej', 'sprej', 'spre', 'sanpre', 'sampre', 'sapre', 'sanpray', 'jampare'),
    'extractor': ('istraktar', 'ekstraktar', 'extraktar', 'estraktar'),
    'change': ('jainj', 'chainj', 'chenj'),
    'check': ('chek',),
    'temperature': ('tanparechar', 'tamparechar', 'tamprechar', 'temprechar', 'temparechar', 'tempreture',
                    'temprecher', 'tamparecher', 'tanprechar'),
    'robot': ('robo',),
    'mein': ('men',),
    # seen 27-28 Oct: "Letal temperature hai hai 692" = "metal temperature high hai 692"
    'metal temperature': ('letal temperature', 'ledal temperature', 'metal tanparechar', 'letal tanparechar'),
    'temperature high hai': ('temperature hai hai',),
    'temperature high hone': ('temperature hai hone',),
    'ladle': ('ledal', 'ledle', 'laddle'),
    'die polish': ('daipolis', 'daipole', 'raipole', 'raipolis', 'aipole', 'dipoles', 'daipolish', 'die polis'),
    'machine': ('masin', 'masing', 'maskin', 'mushiyn', 'mushing', 'mushin', 'mashin', 'musing', 'mashine', 'masinn', 'mastin', 'masim'),
    'flash marne ki': ('lesmar niki', 'lesmarni ki', 'les marni ki', 'lej mar niki', 'les marne ki', 'lesmarne ki'),
    'chalu hone': ('chalo hone',),
    'flash mar': ('falek mar', 'flek mar', 'ples mar', 'fles mar'),
    'isliye': ('iskile', 'iskel', 'iskelie', 'iskeliye'),
}
# applied after the machine spellings above have been fixed
PHRASE_ALIASES = {
    'machine band hai': ('machine bande', 'machine ban do', 'machine bandu', 'machine ban le', 'machine bn le',
                         'machine banya', 'machine ban lege', 'machine bane', 'machine bandle', 'machine bang hai', 'machine bangi'),
}
# "ki bajay se", "ki baze se", "ki bijah se", "ki badese", "ki bashas se" -> "ki wajah se"
# (only between "ki" and "se", so "ki baat se" stays as it is)
WAJAH = re.compile(r"\bki\s+[bvw][aei](?:[jzsyh][a-z]{0,4}\s?|d[a-z]{0,3})se\b", re.IGNORECASE)
_ALIAS_PATTERNS = sorted(
    ((re.compile(r'\b' + r'\s+'.join(map(re.escape, heard.split())) + r'\b', re.IGNORECASE), right)
     for right, heard_list in ALIASES.items() for heard in heard_list),
    key=lambda item: -len(item[0].pattern),
)


_PHRASE_PATTERNS = sorted(
    ((re.compile(r'\b' + r'\s+'.join(map(re.escape, heard.split())) + r'\b', re.IGNORECASE), right)
     for right, heard_list in PHRASE_ALIASES.items() for heard in heard_list),
    key=lambda item: -len(item[0].pattern),
)


def apply_aliases(text: str) -> str:
    for _ in range(2):   # one fix can complete another ("metal tanparechar hai hai")
        for pattern, right in _ALIAS_PATTERNS:
            text = pattern.sub(right, text)
    for pattern, right in _PHRASE_PATTERNS:
        text = pattern.sub(right, text)
    return WAJAH.sub('ki wajah se', text)


def correct_shop_terms(text: str, terms: list[str] | None = None) -> str:
    if not text or not text.strip():
        return text
    # Cached: reports apply this to every row on every load (and to 2000 rows for Excel).
    return _correct(text, tuple(terms) if terms else DEFAULT_TERMS)


@lru_cache(maxsize=8192)
def _correct(text: str, terms: tuple[str, ...]) -> str:
    text = re.sub(r'(?<=[A-Za-z]{2})(?=\d)', ' ', text)
    text = apply_aliases(text)
    keyed = _keyed_terms(terms)
    matches = list(re.finditer(r"[A-Za-z']+|[^A-Za-z'\s]+", text))
    tokens = [m.group() for m in matches]
    # the original spacing before each token, so untouched text is rebuilt exactly
    gaps = [text[(matches[i - 1].end() if i else 0):m.start()] for i, m in enumerate(matches)]
    words = [i for i, tok in enumerate(tokens) if re.match(r"[A-Za-z']", tok)]

    # Every window of 1..4 consecutive words, scored against every term.
    candidates = []
    for start in range(len(words)):
        for size in range(1, MAX_WINDOW_WORDS + 1):
            if start + size > len(words):
                break
            span = words[start:start + size]
            if span[-1] - span[0] != size - 1:   # punctuation inside the window
                break
            heard = ' '.join(tokens[i] for i in span)
            hindi = {tokens[i].lower() for i in span} & HINDI_WORDS
            key = sound_key(heard)
            if len(key) < MIN_SOUND_LENGTH:
                continue
            for term, term_key in keyed:
                if hindi - set(term.lower().split()):
                    continue
                # A longer term must not add words that were not said ("metal temperature" is not
                # "metal temperature low").
                if len(term.split()) > size and len(term_key) - len(key) >= 2:
                    continue
                if heard.lower() == term.lower():
                    score = 1.0
                else:
                    # cheap upper bounds first; the full ratio only for plausible pairs
                    if 2 * min(len(key), len(term_key)) / (len(key) + len(term_key)) < MIN_SIMILARITY:
                        continue
                    matcher = SequenceMatcher(None, key, term_key)
                    if matcher.quick_ratio() < MIN_SIMILARITY:
                        continue
                    score = matcher.ratio()
                if score >= MIN_SIMILARITY and size > 1 and _edge_word_spare(tokens, span, term_key, score):
                    continue
                if score >= MIN_SIMILARITY:
                    candidates.append((score, len(term_key), start, size, term))

    # Longest heard phrase first ("gay polis" -> "die polish" beats "polis" -> "polish"),
    # then best score; never overlapping.
    taken = set()
    replace = {}
    for score, _, start, size, term in sorted(candidates, key=lambda c: (-c[3], -c[0], -c[1])):
        idx = set(range(start, start + size))
        if idx & taken:
            continue
        taken |= idx
        replace[start] = (size, term)

    out = []
    pos = 0
    while pos < len(tokens):
        if pos in words:
            w = words.index(pos)
            if w in replace:
                size, term = replace[w]
                out.append(gaps[pos] + term)
                pos = words[w + size - 1] + 1
                continue
        out.append(gaps[pos] + tokens[pos])
        pos += 1

    result = ''.join(out).strip()
    return result[:1].upper() + result[1:] if result else result
