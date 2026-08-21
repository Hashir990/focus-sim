"""Answers that are not words, and the clues that carry them.

Everything here is deliberately outside the app's Scrabble dictionary:
abbreviations, brands and famous names. They exist because ordinary English is
thin at three letters, and a grid that needs a lot of threes ends up reaching
for `ort`, `ait` and `eft` — words no solver gets from the crossing letters
because no solver has met them. `IBM` and `UFO` are the opposite: instantly
gettable, and they were never in the dictionary to begin with.

Two rules, both load-bearing:

  * **Nothing here may be an ordinary word.** `ram`, `led`, `pin`, `zip` and
    `who` are all abbreviations too, and all of them already have a dictionary
    clue. Putting them here would silently override it, and a solver who read
    "the chip's memory" for an answer clued elsewhere as "male sheep" would be
    right to file a bug. Adding a word that already exists is the mistake this
    file is most likely to invite.
  * **A clue must be gettable cold.** Not a definition of the letters —
    something a person could answer without knowing the abbreviation was the
    kind of thing being asked for.

The dictionary check in tools/cw-prep-sandbox.py reads this file, so anything
here is accepted as an answer; tools/rebuild-bank.py reads it into the fill
pool. Under 58 characters, and never containing the answer itself.
"""

EXTRA = {
    # ---- three letters: the scarce slot this file exists for ----
    'ibm': 'Big Blue of the computing world',
    'bbc': 'British broadcaster known as the Beeb',
    'itv': 'The Beeb’s commercial rival',
    'cnn': 'American round-the-clock news network',
    'hbo': 'Network behind The Sopranos',
    'mtv': 'Channel that once played music videos',
    'nba': 'Basketball league in the States',
    'nfl': 'American football league',
    'nhl': 'Ice hockey league',
    'mlb': 'Baseball league in the States',
    'fbi': 'American federal investigators',
    'cia': 'American foreign intelligence agency',
    'nsa': 'American signals intelligence agency',
    'kgb': 'Soviet secret police',
    'irs': 'The American taxman',
    'nhs': 'British health service',
    'ufo': 'Unidentified thing in the sky',
    'vip': 'Guest who gets the good seats',
    'ceo': 'Person at the top of the company',
    'cfo': 'The money boss in a company',
    'diy': 'Doing the job yourself',
    'faq': 'Page answering the usual questions',
    'sos': 'Distress call tapped in Morse',
    'iou': 'Scribbled note promising to pay you back',
    'mvp': 'Best player of the season',
    'gps': 'Satellite navigation',
    'usb': 'Port you plug a memory stick into',
    'cpu': 'The chip that does the thinking',
    'gpu': 'The chip that draws the graphics',
    'ssd': 'Drive with no moving parts',
    'dvd': 'Disc that replaced the video tape',
    'vhs': 'Tape format that lost to the disc',
    'pdf': 'Document format that never reflows',
    'gif': 'Looping little animation online',
    'jpg': 'Common photo file format',
    'css': 'What styles a web page',
    'url': 'Address you type into a browser',
    'api': 'How one program talks to another',
    'vpn': 'Private tunnel through the internet',
    'sms': 'Text message, formally',
    'suv': 'Big family car, near enough a truck',
    'mph': 'How fast, on a road sign',
    'rpm': 'How fast the record spins',
    'dna': 'The double helix',
    'mri': 'Hospital scan done inside a tube',
    'cpr': 'Chest compressions to restart a heart',
    'tnt': 'Explosive stacked in cartoons',
    'gdp': 'Measure of a country’s output',
    'lol': 'Text shorthand for laughing',
    'bmw': 'German car with a blue-and-white badge',
    'ali': 'Boxer who floated like a butterfly',
    'usa': 'The States, in short',

    # ---- four letters and up: abbreviations ----
    'nasa': 'The American space agency',
    'nato': 'Western military alliance',
    'ussr': 'The Soviet Union, in short',
    'fifa': 'World football’s governing body',
    'ikea': 'Swedish flatpack furniture giant',
    'wifi': 'Wireless internet at home',
    'rsvp': 'Reply asked for on an invitation',

    # ---- famous names ----
    'elvis': 'The King of rock and roll',
    'monet': 'Painter of the water lilies',
    'freud': 'Father of psychoanalysis',
    'messi': 'Argentine football great',
    'pele': 'Brazilian football great',
    'edison': 'Inventor of the light bulb',
    'darwin': 'Naturalist who sailed on the Beagle',
    'mozart': 'Child prodigy from Salzburg',
    'gandhi': 'Leader of India’s independence',
    'austen': 'Author of Pride and Prejudice',
    'orwell': 'Author of Nineteen Eighty-Four',
    'disney': 'The man behind Mickey Mouse',
    'lennon': 'Beatle who wrote Imagine',
    'jordan': 'Basketball great who wore 23',
    'caesar': 'Roman who crossed the Rubicon',
    'picasso': 'Painter of Guernica',
    'galileo': 'Astronomer tried by the Inquisition',
    'mandela': 'Prisoner who went on to lead his country',
    'tolkien': 'Author of The Hobbit',
    'lincoln': 'President who freed the slaves',
    'kennedy': 'President shot in Dallas',
    'beatles': 'The band from Liverpool',
    'ronaldo': 'Portuguese football great',
    'einstein': 'Physicist who explained relativity',
    'napoleon': 'Emperor beaten at Waterloo',
    'socrates': 'Athenian who questioned everything',
    'columbus': 'Sailed the ocean blue in 1492',
    'cleopatra': 'The last pharaoh of Egypt',
    'beethoven': 'Composer who went deaf',
    'churchill': 'Wartime British prime minister',
    'armstrong': 'First man to walk on the moon',

    # ---- more abbreviations ----
    'abc': 'American network named for its first letters',
    'npr': 'American public radio',
    'pbs': 'American public television',
    'gmt': 'The clock the world sets its watch by',
    'ecg': 'Trace of the heartbeat',
    'icu': 'Ward for the sickest patients',
    'phd': 'The doctorate you write a thesis for',
    'mba': 'Business degree for future managers',
    'pta': 'School group of parents and teachers',
    'tsa': 'Airport screeners in America',
    'fda': 'American food and drug regulator',
    'gop': 'Republicans, in American headlines',
    'isp': 'Company that sells you internet',
    'lan': 'Small network inside one building',
    'wwe': 'Wrestling on television',
    'ufc': 'Cage fighting promotion',
    'pga': 'Golf tour in America',
    'atp': 'The men’s tennis tour',
    'nyc': 'The Big Apple, in short',
    'uae': 'Dubai and Abu Dhabi’s country, in short',
    'imf': 'Lender of last resort to countries',
    'ngo': 'Charity working across borders',
    'atv': 'Quad bike for rough ground',
    'kfc': 'The Colonel’s fried chicken chain',
    'amd': 'Chipmaker that rivals Intel',
    'opec': 'Cartel of oil-producing countries',
    'gcse': 'British exam taken at sixteen',

    # ---- brands ----
    'sony': 'Japanese maker of the Walkman',
    'lego': 'Danish bricks that hurt to step on',
    'audi': 'German car wearing four rings',
    'ebay': 'Online auction site',
    'nokia': 'Finnish phone maker of the brick era',
    'pepsi': 'The cola that is not the other one',
    'honda': 'Japanese maker of the Civic',
    'rolex': 'Swiss watch that signals money',
    'adidas': 'Sportswear wearing three stripes',
    'toyota': 'Japanese maker of the Corolla',
    'nissan': 'Japanese maker of the Micra',
    'boeing': 'American planemaker',
    'ferrari': 'Italian sports car, usually red',
    'porsche': 'German maker of the 911',
    'samsung': 'Korean phone giant',
    'spotify': 'App full of playlists',
    'youtube': 'Where the videos live',
    'netflix': 'Streaming service that killed the video shop',
    'facebook': 'Social network started in a dorm room',
    'microsoft': 'The maker of Windows',
    'starbucks': 'Coffee chain out of Seattle',

    # ---- characters and places ----
    'sherlock': 'Detective of Baker Street',
    'hogwarts': 'School for young wizards',
    'narnia': 'Land through the back of the wardrobe',
    'pikachu': 'Yellow Pokemon that shocks',
    'tetris': 'Puzzle game of falling blocks',

    # ---- more famous names ----
    'turing': 'Codebreaker of Bletchley Park',
    'pasteur': 'Chemist milk is treated in memory of',
    'magellan': 'First to sail right around the world',
    'aristotle': 'Greek who tutored Alexander',
    'kepler': 'Worked out the shape of the orbits',
    'gagarin': 'First man in space',
    'earhart': 'Aviator lost over the Pacific',
    'chopin': 'Composer of the nocturnes',
    'handel': 'Composer of the Messiah',
    'wagner': 'Composer of the Ring cycle',
    'vivaldi': 'Composer of the Four Seasons',
    'brahms': 'Composer of the famous lullaby',
    'rembrandt': 'Dutch master of light and shadow',
    'vermeer': 'Painted the girl with the pearl earring',
    'matisse': 'French painter of bright cut-outs',
    'warhol': 'Painted the soup cans',
    'rodin': 'Sculptor of The Thinker',
    'kafka': 'Author of The Metamorphosis',
    'tolstoy': 'Author of War and Peace',
    'bronte': 'Author of Jane Eyre',
    'hemingway': 'Author of The Old Man and the Sea',
    'chaucer': 'Author of the Canterbury Tales',
    'rowling': 'Author who created Harry Potter',
    'christie': 'Queen of the murder mystery',
    'chaplin': 'Silent star with cane and moustache',
    'hitchcock': 'Director of Psycho',
    'spielberg': 'Director of Jaws',
    'kubrick': 'Director of The Shining',
    'monroe': 'Star of Some Like It Hot',
    'brando': 'Star of The Godfather',
    'hendrix': 'Guitarist who played it left-handed',
    'maradona': 'Footballer of the Hand of God',
    'federer': 'Swiss with twenty grand slams',
    'beckham': 'Footballer who bent it',
    'phelps': 'Swimmer with the most gold medals',
    'hannibal': 'Crossed the Alps with elephants',
    'confucius': 'Chinese teacher of many sayings',
}


# 2026-08-21. Everyday terms the Scrabble dictionary has never heard of, which
# is exactly what this file is for. ZOD is the Superman villain; Hashir named
# him. ZAG only exists beside ZIG, which is the one case where that is fine —
# nobody meets `zag` anywhere else, but everybody has met it there.
EXTRA.update({
    'zod':      'General who menaces Superman',
    'zag':      'Turn back the other way, after a zig',
    'vlog':     'Video diary posted online',
    'donut':    'Ring-shaped fried treat',
    'buzzword': 'Fashionable bit of jargon',
})


# 2026-08-21. The other three-letter source, and the less picked-over one: this
# file holds what the dictionary has never heard of, and three-letter
# abbreviations are exactly that. Everything here is instantly gettable and none
# of it is an ordinary word, which is the rule at the top of this file.
EXTRA.update({
    'aol':  'Dial-up era giant of the internet',
    'brb':  'Back shortly, in chat shorthand',
    'cbs':  'American network with the eye logo',
    'dhl':  'Parcel courier in yellow and red',
    'dmv':  'Where Americans go for a driving licence',
    'epa':  'American environment agency',
    'faa':  'American aviation regulator',
    'fyi':  'Note meaning this is just so you know',
    'gui':  'The clickable part of a program',
    'han':  'Solo who flew the Millennium Falcon',
    'kia':  'Korean car brand',
    'mpg':  'Fuel economy figure',
    'nbc':  'American network with the peacock',
    'omg':  'Text shorthand for astonishment',
    'wta':  'The women’s tennis tour',
})
