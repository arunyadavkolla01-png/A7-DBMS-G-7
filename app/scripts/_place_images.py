"""
Auto-assign relevant images to nearby places based on keywords
in their name and description.

Each category maps to a small pool of curated Unsplash images.
A deterministic picker (based on the place name) ensures that the
SAME place always gets the SAME image, but different places get
different images even within the same category.
"""

# ═══════════════════════════════════════════════════════════════
#  Curated Unsplash image pools (verified public URLs)
# ═══════════════════════════════════════════════════════════════

_IMAGES = {
    "beach": [
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80",
        "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=600&q=80",
        "https://images.unsplash.com/photo-1505228395891-9a51e7e86bf6?w=600&q=80",
        "https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?w=600&q=80",
        "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80",
    ],
    "island": [
        "https://images.unsplash.com/photo-1559128010-7c1ad6e1b6a5?w=600&q=80",
        "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80",
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80",
    ],
    "temple": [
        "https://images.unsplash.com/photo-1545046120-3fa3fcbbcd32?w=600&q=80",
        "https://images.unsplash.com/photo-1528181304800-259b08848526?w=600&q=80",
        "https://images.unsplash.com/photo-1533050487297-09b450131914?w=600&q=80",
        "https://images.unsplash.com/photo-1600610703860-16e56e0a1b1f?w=600&q=80",
    ],
    "mosque": [
        "https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=600&q=80",
        "https://images.unsplash.com/photo-1519817650390-64a93db51149?w=600&q=80",
    ],
    "church": [
        "https://images.unsplash.com/photo-1548625149-fc4a29cf7092?w=600&q=80",
        "https://images.unsplash.com/photo-1548048026-5a1a941d93d3?w=600&q=80",
    ],
    "museum": [
        "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?w=600&q=80",
        "https://images.unsplash.com/photo-1566122656-1b1f6d4be2e8?w=600&q=80",
        "https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=600&q=80",
    ],
    "market": [
        "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=600&q=80",
        "https://images.unsplash.com/photo-1533903345306-15d1c30952de?w=600&q=80",
        "https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?w=600&q=80",
    ],
    "waterfall": [
        "https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?w=600&q=80",
        "https://images.unsplash.com/photo-1552083375-1447ce886485?w=600&q=80",
        "https://images.unsplash.com/photo-1502741224143-90386d7f8c82?w=600&q=80",
    ],
    "lake": [
        "https://images.unsplash.com/photo-1439853949127-fa647821eba0?w=600&q=80",
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80",
    ],
    "river": [
        "https://images.unsplash.com/photo-1502741224143-90386d7f8c82?w=600&q=80",
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80",
    ],
    "mountain": [
        "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80",
        "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&q=80",
        "https://images.unsplash.com/photo-1454391304352-2bf4678b1a7a?w=600&q=80",
        "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=600&q=80",
    ],
    "volcano": [
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80",
        "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=600&q=80",
    ],
    "glacier": [
        "https://images.unsplash.com/photo-1483664852095-d6cc6870702d?w=600&q=80",
        "https://images.unsplash.com/photo-1551524559-8af4e6624178?w=600&q=80",
    ],
    "desert": [
        "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=600&q=80",
        "https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=600&q=80",
    ],
    "park": [
        "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&q=80",
        "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80",
        "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&q=80",
    ],
    "forest": [
        "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&q=80",
        "https://images.unsplash.com/photo-1497250681960-ef046c08a56e?w=600&q=80",
    ],
    "wildlife": [
        "https://images.unsplash.com/photo-1568577109735-4cbb4e95ad2c?w=600&q=80",
        "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&q=80",
        "https://images.unsplash.com/photo-1552410260-67e01f4c1d43?w=600&q=80",
    ],
    "sunset": [
        "https://images.unsplash.com/photo-1495954484750-af469f2f9be5?w=600&q=80",
        "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=600&q=80",
    ],
    "aurora": [
        "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=600&q=80",
        "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=600&q=80",
    ],
    "food": [
        "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80",
        "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80",
        "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",
    ],
    "wine": [
        "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&q=80",
        "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=600&q=80",
    ],
    "castle": [
        "https://images.unsplash.com/photo-1533154683836-84ea7a0bc310?w=600&q=80",
        "https://images.unsplash.com/photo-1520637836862-4d197d17c50a?w=600&q=80",
    ],
    "palace": [
        "https://images.unsplash.com/photo-1566122656-1b1f6d4be2e8?w=600&q=80",
        "https://images.unsplash.com/photo-1587135941948-670b381f08ce?w=600&q=80",
    ],
    "tower": [
        "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=80",
        "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=80",
    ],
    "bridge": [
        "https://images.unsplash.com/photo-1541849546-216549ae216d?w=600&q=80",
        "https://images.unsplash.com/photo-1519677100203-a0e668c92439?w=600&q=80",
    ],
    "city": [
        "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=600&q=80",
        "https://images.unsplash.com/photo-1514924013411-cbf25faa35bb?w=600&q=80",
        "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=600&q=80",
    ],
    "shopping": [
        "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&q=80",
        "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80",
    ],
    "nightlife": [
        "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600&q=80",
        "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=600&q=80",
    ],
    "boat": [
        "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80",
        "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=600&q=80",
    ],
    "train": [
        "https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=600&q=80",
        "https://images.unsplash.com/photo-1535535112387-56ffe8db21ff?w=600&q=80",
    ],
    "stadium": [
        "https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=600&q=80",
    ],
    "spa": [
        "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&q=80",
        "https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=600&q=80",
    ],
    "default": [
        "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=80",
        "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=600&q=80",
        "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=600&q=80",
    ],
}


# ═══════════════════════════════════════════════════════════════
#  Keyword map — ordered most-specific → most-generic
# ═══════════════════════════════════════════════════════════════

_KEYWORD_MAP = [
    # Specific landmarks / types
    ("mosque",      ["mosque", "masjid", "blue mosque", "hagia sophia"]),
    ("church",      ["church", "cathedral", "basilica", "chapel"]),
    ("temple",      ["temple", "shrine", "monastery", "pagoda", "torii", "wat ", "inari"]),
    ("museum",      ["museum", "louvre", "gallery", "moma", "guggenheim", "van gogh", "teamlab"]),
    ("palace",      ["palace", "royal residence", "sultan"]),
    ("castle",      ["castle", "fort", "citadel", "fortress", "amber fort", "fort aguada"]),
    ("tower",       ["tower", "skyscraper", "burj", "eiffel", "empire state", "observation deck"]),
    ("bridge",      ["bridge", "charles bridge"]),
    ("stadium",     ["stadium", "arena", "colosseum", "circus maximus"]),
    ("aurora",      ["aurora", "northern lights", "borealis"]),
    ("glacier",     ["glacier", "ice cap", "ice cave"]),
    ("volcano",     ["volcano", "crater", "batur", "etna", "fuji"]),

    # Nature
    ("waterfall",   ["waterfall", "falls", "gullfoss"]),
    ("lake",        ["lake", "lago", "lagoon", "pond"]),
    ("river",       ["river", "stream", "creek", "flood"]),
    ("beach",       ["beach", "bay", "shore", "coast", "sandbank", "seaside"]),
    ("island",      ["island", "atoll", "reef", "palm jumeirah", "sentosa"]),
    ("desert",      ["desert", "safari", "dune", "camel", "sahara"]),
    ("mountain",    ["mountain", "trek", "peak", "hike", "himalaya", "alps", "summit", "kilimanjaro", "jungfrau"]),
    ("forest",      ["forest", "jungle", "rainforest", "bamboo grove", "woodland", "monkey forest"]),
    ("park",        ["park", "garden", "grove", "botanical", "gardens by the bay", "keukenhof", "park guell", "montmartre"]),
    ("spa",         ["spa", "hot spring", "onsen", "lagoon spa", "blue lagoon", "wellness"]),

    # Food & drink
    ("wine",        ["wine", "winery", "vineyard", "tasting room", "wine tasting"]),
    ("food",        ["food", "dining", "restaurant", "cuisine", "sushi", "ramen", "market food", "hawker", "tsukiji", "chao phraya"]),

    # Experiences
    ("nightlife",   ["nightlife", "night club", "nightclub", "bar street", "broadway", "show", "opera", "west end", "theater", "gion", "fado", "bangla road"]),
    ("shopping",    ["shopping", "mall", "boutique", "souk", "bazaar", "market", "chatuchak", "myeongdong"]),
    ("boat",        ["cruise", "boat", "ferry", "sail", "yacht", "canoe", "kayak", "star ferry", "houseboat"]),
    ("train",       ["train", "railway", "tram", "peak tram", "bullet train", "jungfraujoch"]),

    # Wildlife
    ("wildlife",    ["monkey", "elephant", "penguin", "dolphin", "tiger", "lion", "wildlife", "zoo", "macaque", "turtle"]),

    # Fallback
    ("sunset",      ["sunset", "sunrise", "sunset point"]),
    ("city",        ["square", "plaza", "district", "street", "crossing", "market", "old town", "medina", "alfama", "shibuya", "rambla", "arashiyama"]),
]


# ═══════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════

def _hash_pick(seed: str, urls: list) -> str:
    """Deterministically pick a URL based on the seed string."""
    if not urls:
        return ""
    idx = sum(ord(c) for c in seed) % len(urls)
    return urls[idx]


def pick_place_image(name: str, description: str = "") -> str:
    """
    Return a relevant Unsplash image URL for a nearby place,
    based on keywords in its name and description.
    Same place → same image. Different places → different images.
    """
    text = f"{name} {description}".lower()

    for category, keywords in _KEYWORD_MAP:
        if any(kw in text for kw in keywords):
            pool = _IMAGES.get(category)
            if pool:
                return _hash_pick(name, pool)

    # No match — rotate between a few generic travel images
    return _hash_pick(name, _IMAGES["default"])