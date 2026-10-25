"""Province reference table and name matching shared by the build scripts."""
import re
import unicodedata

# INE autonomous-community codes
CCAA = {
    "01": "Andalucía", "02": "Aragón", "03": "Asturias", "04": "Illes Balears",
    "05": "Canarias", "06": "Cantabria", "07": "Castilla y León",
    "08": "Castilla-La Mancha", "09": "Cataluña", "10": "C. Valenciana",
    "11": "Extremadura", "12": "Galicia", "13": "Madrid", "14": "Murcia",
    "15": "Navarra", "16": "País Vasco", "17": "La Rioja", "18": "Ceuta",
    "19": "Melilla",
}

# Aliases are matched as token sets (accents, case and punctuation ignored),
# so "Coruña, A", "Coruña (A)" and "A Coruña" all hit the same entry.
CCAA_ALIASES = {
    "01": ["andalucia"], "02": ["aragon"],
    "03": ["asturias", "asturias principado de"],
    "04": ["balears illes", "illes balears", "baleares"],
    "05": ["canarias"], "06": ["cantabria"], "07": ["castilla y leon"],
    "08": ["castilla la mancha"], "09": ["cataluna"],
    "10": ["comunitat valenciana", "comunidad valenciana"],
    "11": ["extremadura"], "12": ["galicia"],
    "13": ["madrid comunidad de", "comunidad de madrid", "madrid comunidad"],
    "14": ["murcia region de", "region de murcia"],
    "15": ["navarra comunidad foral de", "comunidad foral de navarra"],
    "16": ["pais vasco", "euskadi"], "17": ["rioja la", "la rioja"],
    "18": ["ceuta"], "19": ["melilla"],
}

# code: (display name, ccaa code, aliases)
PROVINCES = {
    "01": ("Araba/Álava", "16", ["araba alava", "alava"]),
    "02": ("Albacete", "08", []),
    "03": ("Alicante", "10", ["alicante alacant"]),
    "04": ("Almería", "01", []),
    "05": ("Ávila", "07", []),
    "06": ("Badajoz", "11", []),
    "07": ("Illes Balears", "04", ["balears illes", "baleares"]),
    "08": ("Barcelona", "09", []),
    "09": ("Burgos", "07", []),
    "10": ("Cáceres", "11", []),
    "11": ("Cádiz", "01", []),
    "12": ("Castellón", "10", ["castellon castello"]),
    "13": ("Ciudad Real", "08", []),
    "14": ("Córdoba", "01", []),
    "15": ("A Coruña", "12", ["coruna a"]),
    "16": ("Cuenca", "08", []),
    "17": ("Girona", "09", []),
    "18": ("Granada", "01", []),
    "19": ("Guadalajara", "08", []),
    "20": ("Gipuzkoa", "16", ["guipuzcoa"]),
    "21": ("Huelva", "01", []),
    "22": ("Huesca", "02", []),
    "23": ("Jaén", "01", []),
    "24": ("León", "07", []),
    "25": ("Lleida", "09", []),
    "26": ("La Rioja", "17", ["rioja la"]),
    "27": ("Lugo", "12", []),
    "28": ("Madrid", "13", ["madrid comunidad de"]),
    "29": ("Málaga", "01", []),
    "30": ("Murcia", "14", ["murcia region de"]),
    "31": ("Navarra", "15", ["navarra comunidad foral de"]),
    "32": ("Ourense", "12", []),
    "33": ("Asturias", "03", ["asturias principado de"]),
    "34": ("Palencia", "07", []),
    "35": ("Las Palmas", "05", ["palmas las"]),
    "36": ("Pontevedra", "12", []),
    "37": ("Salamanca", "07", []),
    "38": ("S.C. Tenerife", "05", ["santa cruz de tenerife"]),
    "39": ("Cantabria", "06", []),
    "40": ("Segovia", "07", []),
    "41": ("Sevilla", "01", []),
    "42": ("Soria", "07", []),
    "43": ("Tarragona", "09", []),
    "44": ("Teruel", "02", []),
    "45": ("Toledo", "08", []),
    "46": ("Valencia", "10", ["valencia valencia"]),
    "47": ("Valladolid", "07", []),
    "48": ("Bizkaia", "16", ["vizcaya"]),
    "49": ("Zamora", "07", []),
    "50": ("Zaragoza", "02", []),
    "51": ("Ceuta", "18", []),
    "52": ("Melilla", "19", []),
}


def tokens(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return frozenset(t for t in re.split(r"[^a-z0-9]+", s.lower()) if t)


def _index(entries):
    idx = {}
    for code, aliases in entries:
        for a in aliases:
            idx.setdefault(tokens(a), code)
    return idx


_PROV_IDX = _index((c, [v[0]] + v[2]) for c, v in PROVINCES.items())
_CCAA_IDX = _index((c, [CCAA[c]] + a) for c, a in CCAA_ALIASES.items())
NATIONAL = {tokens("total nacional"), tokens("nacional")}


def province_code(name):
    return _PROV_IDX.get(tokens(name))


def ccaa_code(name):
    return _CCAA_IDX.get(tokens(name))


def is_national(name):
    return tokens(name) in NATIONAL
