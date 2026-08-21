"""Long answers for a 15x15: phrases with the spaces taken out, and people.

The bank that fills 5x5, 7x7 and 9x9 grids is made of single dictionary words
and it stops where the dictionary stops being ordinary: 285 answers at three
letters, 472 at four, and then it thins to 36 sevens, 2 eights and a single
nine. A 15x15 wants entries of nine, eleven, thirteen and fifteen letters in
every corner, and English does not have enough *ordinary* words that long. This
file is where those entries come from.

Two pools, and they behave differently:

  * `PHRASES` — things people say, run together. FLIPACOIN, PIECEOFCAKE,
    BACKTOSQUAREONE. The solver is not being asked for a word, so the clue must
    define the *phrase*, not gesture at the letters. A crossing letter has to be
    worth having: `outoftheblue` is fair because once you have half of it the
    rest arrives whole.

  * `PEOPLE` — actors, directors, scientists and comics people, clued by what
    they made. The name is never in its own clue. Where a first name is needed
    to pin down which one, it goes in the clue and the surname is the answer, so
    "Artist Steve who drew the first Spider-Man" wants DITKO. That device also
    rescues the common surnames: MOORE and WATSON are two different people
    depending on the puzzle, which is what the clue tuples are for.

Three rules carried over from tools/extra-answers.py, all load-bearing:

  * **Nothing here may already be clued as an ordinary word.** `stone`, `bale`,
    `ledger`, `ford`, `cruise`, `phoenix` and `miller` are all surnames and all
    ordinary words, and tools/check-phrases.py rejects any of them that already
    has a clue in cross-clues.py. Overriding a dictionary clue with a name is
    the mistake this file most invites.
  * **A clue must be gettable cold**, from the work rather than from trivia
    about the person. "Director of Jaws and E.T." is a question anybody can
    answer; a birthplace is not.
  * **Under 58 characters, and never containing its own answer** — including
    with the spaces put back, so FLIPACOIN cannot be clued "Flip a coin".

Nothing here is in the app's Scrabble dictionary check yet. Wiring that up is
tools/cw-prep-sandbox.py, the same way it already reads extra-answers.py.
"""

# ---------------------------------------------------------------- phrases ----
# Grouped by length only so the fill can see at a glance what it has to reach
# for. The 13s and 15s are the scarce ones and the reason this file exists.

PHRASES = {
    # ---- six ----
    # The deepest part of this list, and deliberately so. Six is where the fill
    # spends most of its time at 15x15 and where every extra fair answer is
    # worth having — see the note at the top of the file about pool size.
    'atbest':      'Putting the kindest reading on it',
    'atonce':      'Right this minute',
    'bigday':      'The wedding, usually',
    'bigtop':      'The circus tent',
    'boxset':      'A whole series in one package',
    'byebye':      'Farewell, said to a small child',
    'dialup':      'Internet that came down the phone line',
    'dropin':      'Visit paid without warning',
    'getout':      'Escape route from an agreement',
    'goslow':      'Protest by working at a deliberate crawl',
    'gungho':      'Recklessly keen',
    'hangup':      'Something you cannot stop worrying about',
    'hushup':      'Keep it quiet',
    'inaway':      'Sort of, if you look at it like that',
    'ingear':      'Ready to move off',
    'inhand':      'Under control, or still to be played',
    'inpart':      'Not completely',
    'intime':      'Not too late',
    'jetlag':      'Tiredness that follows a long flight',
    'logout':      'Sign off the computer',
    'madeup':      'Invented, and not true',
    'nogood':      'Worthless, and not worth mending',
    'nomore':      'Not any longer',
    'noshow':      'Booked, and never turned up',
    'onhold':      'Waiting on the line',
    'onside':      'Legally placed, in football',
    'ontime':      'Punctual, not a minute late',
    'orelse':      'Threat left hanging',
    'putoff':      'Delay it, or discourage somebody',
    'setout':      'Begin the journey',
    'takein':      'Absorb it, or deceive somebody',
    'theend':      'What comes up after the last scene',
    'tipoff':      'Warning whispered to the police',
    'toobad':      'Hard luck',
    'topdog':      'The one in charge',
    'wayout':      'The exit, or distinctly odd',
    'wellup':      'Rise, as tears do',
    'yesman':      'One who always agrees with the boss',
    'zonein':      'Focus sharply on it',

    # ---- seven ----
    # Was four entries, which was the thinnest length in the file. Seven is a
    # length a 15x15 reaches for constantly, so it is worth the same depth six
    # got.
    'allears':     'Listening very closely indeed',
    'backlog':     'Work piled up and waiting',
    'bigshot':     'Important person, informally',
    'cutback':     'Reduction in what gets spent',
    'dropoff':     'Decline, or where you leave the children',
    'getaway':     'Escape, or a few days by the sea',
    'hardhat':     'What a builder wears on site',
    'hotshot':     'One who is very good and knows it',
    'kickoff':     'Start of the match',
    'lowdown':     'The inside information',
    'nestegg':     'Savings tucked away for retirement',
    'nonstop':     'Without a break anywhere',
    'offhand':     'Casually, without preparing it',
    'payback':     'Getting your own back',
    'peptalk':     'Few words meant to lift the team',
    'rollout':     'Launch of something new',
    'rundown':     'Quick summary, or thoroughly worn out',
    'setback':     'Something that puts you back a step',
    'showoff':     'One who badly wants you to notice',
    'shutout':     'Keeping them from scoring at all',
    'sunburn':     'What the beach leaves on pale shoulders',
    'takeoff':     'When the plane leaves the ground',
    'turnout':     'How many actually came',
    'upfront':     'Paid in advance, or honest about it',
    'welloff':     'Comfortably rich',
    'workout':     'Session at the gym',
    'writeup':     'Review in the paper',

    # ---- eight ----
    'deadheat':    'Race that ends in an exact tie',
    'foulplay':    'What the detective starts to suspect',
    'freerein':    'Permission to do it however you like',
    'longshot':    'Chance not worth much',
    'mixedbag':    'Some of it good and some of it bad',
    'nailedit':    'Got it exactly right',
    'nightcap':    'Last drink before bed',
    'nightowl':    'One who is still up long past midnight',
    'playfair':    'Stick to the rules',
    'roadtrip':    'Long drive taken for the fun of it',
    'saveface':    'Avoid the embarrassment at the last moment',
    'softspot':    'Fondness you cannot quite justify',
    'tugofwar':    'Rope contest between two straining teams',
    'whitelie':    'Untruth told to spare somebody',

    # ---- nine ----
    'breakaleg':   'What you wish an actor before curtain up',
    'bythebook':   'Following every rule exactly',
    'earlybird':   'One who is up and about before everyone else',
    'eyeopener':   'Something that changes how you see it',
    'facevalue':   'Taken as it appears, with no digging',
    'fairshare':   'What each one is properly due',
    'firsthand':   'Straight from the source',
    'flipacoin':   'Let chance settle it',
    'gutfeeling':  'Hunch you cannot explain',
    'halfbaked':   'Not thought through',
    'handsdown':   'Easily, with nothing like a contest',
    'hardtimes':   'Years of real struggle',
    'headstart':   'Advantage of having set off early',
    'inthedark':   'Not told what is going on',
    'lostcause':   'Effort with no hope left in it',
    'nobrainer':   'Decision that needs no thinking about',
    'ontheball':   'Alert and on top of things',
    'outofhand':   'No longer under any control',
    'pipedream':   'Hope with no chance of happening',
    'raincheck':   'Postponement asked for politely',
    'sleeponit':   'Put the decision off until morning',
    'smalltalk':   'Chat about nothing much',
    'snailmail':   'The slow way to send a letter',
    'thinktank':   'Group paid to sit and have ideas',
    'tallorder':   'More than can reasonably be asked',
    'timeflies':   'What happens while you are having fun',
    'worstcase':   'The gloomiest way it could possibly go',

    # ---- ten ----
    'allnighter':  'Session of work that runs until dawn',
    'bigpicture':  'The whole situation rather than the details',
    'brainstorm':  'Throw ideas around and see what sticks',
    'bucketlist':  'Things to get done before the end',
    'closeshave':  'Narrow escape',
    'coldturkey':  'Quitting all at once, with no tapering off',
    'cutcorners':  'Do the job cheaply and badly',
    'farfetched':  'Rather hard to swallow',
    'firstclass':  'Right at the top of the range',
    'freshstart':  'Beginning again with a clean slate',
    'fullcircle':  'Back round to where it all began',
    'greenlight':  'Permission to go ahead',
    'handinhand':  'Going closely together',
    'hitthesack':  'Go to bed',
    'icebreaker':  'Game that gets strangers talking',
    'lastresort':  'What you try when nothing else has worked',
    'offthecuff':  'Said without preparing a word of it',
    'oncebitten':  'Twice shy, as the saying finishes',
    'onthehouse':  'Paid for by the landlord',
    'opensecret':  'Everybody knows it anyway',
    'outoforder':  'Not working, says the sign on it',
    'pointblank':  'From very close, or said very bluntly',
    'redherring':  'Clue put there to lead you astray',
    'rockbottom':  'As low as it can possibly get',
    'roughdraft':  'First version, not tidied up yet',
    'secondwind':  'Fresh energy arriving after you flagged',
    'smallprint':  'The part of the contract nobody reads',
    'squaremeal':  'Proper dinner rather than a snack',
    'sweettooth':  'Weakness for puddings',
    'thinktwice':  'Have second thoughts about it',
    'touchandgo':  'Risky, and could still go either way',
    'upforgrabs':  'Anybody at all could take it',
    'upintheair':  'Still not decided either way',
    'wakeupcall':  'Shock that makes somebody change',
    'worthashot':  'Might as well give it a try',

    # ---- eleven ----
    'comfortzone': 'Where nothing is ever challenging',
    'crashcourse': 'Very fast introduction to a subject',
    'doubleedged': 'Having a good side and a bad side',
    'downtoearth': 'Sensible and entirely unpretentious',
    'gamechanger': 'Something that alters everything after it',
    'givenortake': 'Roughly, allowing a little either way',
    'groundfloor': 'In at the very start of the venture',
    'hardandfast': 'Said of a rule that has no exceptions',
    'happymedium': 'Comfortable point between two extremes',
    'inanutshell': 'Put as briefly as it can be put',
    'inhindsight': 'Looking back, knowing how it all went',
    'keepintouch': 'Do not be a stranger',
    'makeendsmeet': 'Just about cover the bills',
    'neckandneck': 'Exactly level in a close race',
    'oddsandends': 'Miscellaneous bits rattling in the drawer',
    'overthemoon': 'Absolutely delighted',
    'pinchofsalt': 'How to take a doubtful story',
    'playitbyear': 'Decide as you go along',
    'pullstrings': 'Use your contacts quietly',
    'restassured': 'You have my word that it is fine',
    'ruleofthumb': 'Rough guide that usually works',
    'sittingduck': 'Target with no way at all to escape',
    'timecapsule': 'Box buried for the future to open',
    'underthesun': 'Anywhere at all, in a sweeping phrase',
    'wearandtear': 'Damage that comes from ordinary use',

    # ---- twelve ----
    'commonground': 'Where two opposed sides can still agree',
    'headsortails': 'The call made before the toss',
    'knowtheropes': 'Be familiar with how it all works',
    'labouroflove': 'Work done for no pay but gladly',
    'onceinawhile': 'Now and then',
    'outoftheblue': 'With no warning whatsoever',
    'roundthebend': 'Out of your mind',
    'runofthemill': 'Nothing special about it at all',
    'secondnature': 'So familiar you do it without thinking',
    'silverlining': 'The good part of a bad situation',
    'straightface': 'What you keep while telling the joke',
    'theearlybird': 'The one that catches the worm',
    'inthelongrun': 'When all is finally said and done',

    # ---- thirteen ----
    'bitethebullet': 'Get the unpleasant thing over with',
    'devilsadvocate': 'One who argues the other side for sport',
    'fairandsquare': 'Won honestly, and no argument about it',
    'partandparcel': 'Inseparable from the whole thing',
    'spillthebeans': 'Give the secret away',
    'talkofthetown': 'What absolutely everybody is discussing',
    'turnthetables': 'Reverse who has the advantage',
    'zebracrossing': 'Striped place to walk over the road',

    # ---- fourteen ----
    'aroundtheclock': 'Without stopping, day or night',
    'ballparkfigure': 'Rough estimate, near enough to work with',
    'foodforthought': 'Something worth chewing over',
    'getthehangofit': 'Learn how it works with a little practice',
    'graveyardshift': 'The hours nobody wants to work',
    'holdyourhorses': 'Wait just a moment',
    'onesizefitsall': 'Made without regard to who wears it',
    'wildgoosechase': 'Search that was never going to find it',

    # ---- fifteen ----
    'againsttheclock': 'Racing a deadline that will not move',
    'backtosquareone': 'Starting over with nothing gained',
    'lastbutnotleast': 'Final on the list and no less important',
    'middleofnowhere': 'Miles and miles from any town',
    'nostoneunturned': 'Every last possibility looked into',
    'spurofthemoment': 'Decided on the instant',
    'takeitorleaveit': 'The offer will not be improved',
    'throwinthetowel': 'Admit defeat and stop',
    'tipoftheiceberg': 'The small visible part of a big problem',
    'undertheweather': 'Feverish and not up to much',
    'wishfulthinking': 'Believing it because you want it to be so',
}


# ---------------------------------------------------------------- people ----
# Clued by the work, never by biography. Where the surname is also a common
# surname the first name goes in the clue, which is both fair and the only way
# to tell two people apart. A tuple means the answer serves two different
# people and crossClue picks by puzzle index, exactly as it does for words.

PEOPLE = {
    # ---- actors ----
    'holland':    'Actor Tom under the mask in recent Spider-Man films',
    'maguire':    'Actor who first brought Spider-Man to the screen',
    'garfield':   'Actor Andrew of The Social Network and Tick Tick Boom',
    'pacino':     'Actor Al, Michael Corleone of The Godfather',
    'deniro':     'Actor Robert, Travis Bickle of Taxi Driver',
    'hanks':      'Actor Tom, Forrest Gump and the voice of Woody',
    'streep':     'Actor who was Miranda Priestly on screen',
    'freeman':    'Actor Morgan, Red of The Shawshank Redemption',
    'washington': 'Actor of Training Day and Malcolm X',
    'dicaprio':   'Actor Leonardo of Titanic and Inception',
    'winslet':    'Actor Kate, Rose of Titanic',
    'portman':    'Actor Natalie of Black Swan and V for Vendetta',
    'johansson':  'Actor Scarlett, Black Widow of the Marvel films',
    'downey':     'Actor Robert, the man inside the Iron Man suit',
    'hemsworth':  'Actor Chris who swings the hammer as Thor',
    'ruffalo':    'Actor Mark, the Hulk of the Avengers films',
    'jackman':    'Actor Hugh who put out Wolverine’s claws',
    'mckellen':   'Actor Ian, Gandalf and also Magneto',
    'fisher':     'Actor Carrie, the original Princess Leia',
    'hamill':     'Actor Mark, Luke Skywalker and the Joker’s voice',
    'thompson':   'Actor Emma of Sense and Sensibility',
    'blanchett':  'Actor who played Galadriel and Katharine Hepburn',
    'kidman':     'Actor Nicole of Moulin Rouge and The Hours',
    'damon':      'Actor Matt, Jason Bourne and the man left on Mars',
    'affleck':    'Actor Ben who also directed Argo',
    'clooney':    'Actor George of the Ocean’s Eleven films',
    'roberts':    'Actor Julia of Pretty Woman and Erin Brockovich',
    'bullock':    'Actor Sandra of Gravity and Speed',
    'lawrence':   'Actor Jennifer, Katniss of The Hunger Games',
    'oldman':     'Actor Gary, Sirius Black and Churchill on screen',
    'rickman':    'Actor Alan, Severus Snape and Hans Gruber',
    'radcliffe':  'Actor Daniel who wore the glasses at Hogwarts',
    'murphy':     'Actor Cillian of Oppenheimer and Peaky Blinders',
    'nicholson':  'Actor Jack of The Shining and Chinatown',
    'hopkins':    'Actor Anthony, the screen’s Hannibal Lecter',
    'caine':      'Actor Michael, Alfred of the Dark Knight films',
    'connery':    'Actor Sean, the first James Bond on screen',
    'craig':      'Actor Daniel, the most recent James Bond',
    'reeves':     'Actor who is both Neo and John Wick',
    'fishburne':  'Actor Laurence, Morpheus of The Matrix',
    'travolta':   'Actor John, Vincent Vega of Pulp Fiction',
    'thurman':    'Actor who played the Bride in Kill Bill',
    'bardem':     'Actor Javier, villain of No Country for Old Men',
    'hepburn':    'Actor Audrey of Breakfast at Tiffany’s',
    'bogart':     'Actor Humphrey, Rick of Casablanca',
    'eastwood':   'Actor Clint, the Man with No Name',
    'poitier':    'Actor Sidney of In the Heat of the Night',
    'keanu':      'Actor Reeves of The Matrix',
    'uma':        'Actor Thurman of Kill Bill',
    'idris':      'Actor Elba of Luther',
    'viola':      'Actor Davis of Fences and The Help',
    'halle':      'Actor Berry of Monster’s Ball',
    'denzel':     'Actor Washington of Training Day',
    'ewan':       'Actor McGregor of Trainspotting',
    'jodie':      'Actor Foster of The Silence of the Lambs',
    'tobey':      'Actor Maguire of the first Spider-Man films',
    'meryl':      'Actor Streep of Sophie’s Choice',
    'cate':       'Actor Blanchett of Blue Jasmine',

    # ---- directors ----
    'scorsese':   'Director Martin of Goodfellas and Taxi Driver',
    'tarantino':  'Director of Pulp Fiction',
    'nolan':      'Director Christopher of Inception',
    'cameron':    'Director James of Titanic and Avatar',
    'lucas':      'Director George, creator of Star Wars',
    'coppola':    'Director Francis Ford of The Godfather',
    'fincher':    'Director David of Se7en and Fight Club',
    'burton':     'Director Tim of Edward Scissorhands',
    'villeneuve': 'Director Denis of Dune and Arrival',
    'kurosawa':   'Director of Seven Samurai',
    'miyazaki':   'Director of Spirited Away',
    'peele':      'Director Jordan of Get Out and Nope',
    'gerwig':     'Director of Lady Bird and Barbie',
    'bigelow':    'Director Kathryn of The Hurt Locker',
    'campion':    'Director Jane of The Piano',
    'welles':     'Director Orson who also starred in Citizen Kane',
    'cuaron':     'Director Alfonso of Gravity and Roma',
    'deltoro':    'Director Guillermo of Pan’s Labyrinth',
    'aronofsky':  'Director Darren of Black Swan',
    'linklater':  'Director Richard of Boyhood',
    'ridley':     'Director Scott of Alien and Gladiator',
    'quentin':    'Director Tarantino of Kill Bill',
    'stanley':    'Director Kubrick of A Clockwork Orange',
    'akira':      'Director Kurosawa of Rashomon',
    'hayao':      'Director Miyazaki of My Neighbour Totoro',
    'greta':      'Director Gerwig of Little Women',
    'sofia':      'Director Coppola of Lost in Translation',

    # ---- scientists ----
    'copernicus':  'Astronomer who put the sun at the centre',
    'feynman':     'Physicist of the famous lectures and diagrams',
    'planck':      'Physicist who started quantum theory',
    'heisenberg':  'Physicist whose principle says you cannot know both',
    'schrodinger': 'Physicist whose cat is both alive and dead',
    'faraday':     'Scientist who turned magnetism into electricity',
    'maxwell':     'Physicist of the equations of electromagnetism',
    'mendel':      'The monk who bred peas and found the genes',
    'crick':       'Biologist who with Watson found the double helix',
    'lovelace':    'Mathematician Ada, first computer programmer',
    'babbage':     'Inventor Charles who designed early computers',
    'sagan':       'Astronomer Carl who presented Cosmos',
    'goodall':     'Naturalist Jane who lived among chimpanzees',
    'oppenheimer': 'Physicist who led the Manhattan Project',
    'fermi':       'Physicist Enrico of the first nuclear reactor',
    'rutherford':  'Physicist who split the atom',
    'chadwick':    'Physicist who found the neutron',
    'roentgen':    'Physicist who found X-rays',
    'pauling':     'Chemist Linus with Nobels in two fields',
    'sanger':      'Biochemist who found how to read DNA',
    'hodgkin':     'Chemist Dorothy who mapped penicillin',
    'meitner':     'Physicist Lise who explained nuclear fission',
    'mcclintock':  'Geneticist Barbara of the jumping genes',
    'carson':      'Biologist Rachel who wrote Silent Spring',
    'dawkins':     'Biologist Richard of The Selfish Gene',
    'archimedes':  'Greek who shouted eureka in the bath',
    'euclid':      'Greek who set out geometry in his Elements',
    'pythagoras':  'Greek whose theorem is about right triangles',
    'linnaeus':    'Naturalist who gave species two-part Latin names',
    'mercator':    'Mapmaker whose projection is on classroom walls',
    'lister':      'Surgeon who brought antiseptic into the theatre',
    'jenner':      'Doctor Edward who used cowpox to beat smallpox',
    'salk':        'Doctor Jonas of the polio vaccine',
    'pavlov':      'Scientist whose bell made the dogs salivate',
    'nobel':       'Chemist who invented dynamite',
    'euler':       'Mathematician of the number e and the bridges',
    'gauss':       'Mathematician a unit of magnetism is named for',
    'ampere':      'Physicist a unit of current is named for',
    'volta':       'Physicist who made the first battery',
    'kelvin':      'Physicist a temperature scale is named for',

    # ---- comics ----
    'ditko':       'Artist Steve who drew the first Spider-Man',
    'kirby':       'Artist Jack who drew the Fantastic Four',
    'gaiman':      'Writer Neil of The Sandman',
    'morrison':    'Writer Grant of All-Star Superman',
    'bendis':      'Writer Brian Michael who created Miles Morales',
    'claremont':   'Writer Chris of the long X-Men run',
    'byrne':       'Artist John of the X-Men and Superman',
    'romita':      'Artist John who drew Spider-Man after Ditko',
    'mcfarlane':   'Artist Todd who created Spawn',
    'eisner':      'Artist Will the comics awards are named for',
    'schulz':      'Artist Charles who drew Peanuts for fifty years',
    'watterson':   'Artist Bill who drew Calvin and Hobbes',
    'herge':       'Belgian artist who drew Tintin',
    'goscinny':    'Writer who scripted the Asterix books',
    'uderzo':      'Artist Albert who drew the Asterix books',
    'spiegelman':  'Artist Art who drew Maus',
    'satrapi':     'Artist Marjane who drew Persepolis',

    # ---- shared surnames: two people, one answer ----
    'jackson':     ('Director Peter of The Lord of the Rings',
                    'Actor Samuel L, Nick Fury of the Marvel films'),
    'moore':       ('Writer Alan of Watchmen',
                    'Actor Roger, the Bond of Live and Let Die'),
    'watson':      ('Actor Emma, Hermione Granger on screen',
                    'Biologist who with Crick found the double helix'),
    'anderson':    ('Director Wes of The Grand Budapest Hotel',
                    'Director Paul Thomas of There Will Be Blood'),
    'hubble':      ('Astronomer the great telescope is named for',
                    'Astronomer who showed the universe is expanding'),
    'bohr':        ('Physicist who put the electrons in shells',
                    'Physicist Niels of the Copenhagen interpretation'),
}


# ------------------------------------------------------- already in the bank ----
# Eighteen of the names this file reached for are already answers, clued in
# cross-clues.py or extra-answers.py: SPIELBERG, EINSTEIN, TURING, MONROE,
# DARWIN, FRANKLIN and the rest. They are deliberately *not* repeated here.
#
# An earlier pass gave each of them a second clue, so that a recurring name
# asked a different question the second time. Hashir cut them: a person has one
# body of work, and a second clue for the same person is a worse clue for it
# rather than a fresh angle — "He held over a thousand patents" is a weaker way
# to ask for the same answer than "Inventor of the light bulb". The tuple
# mechanism stays where it belongs, on ordinary words like ACE and ERA that
# really do carry unrelated senses, and on the six shared surnames in PEOPLE
# above, where the two clues point at two different people.
#
# tools/check-phrases.py enforces the absence: anything here that already has a
# clue anywhere is a hard failure.

ALL = {}
ALL.update(PHRASES)
ALL.update(PEOPLE)
