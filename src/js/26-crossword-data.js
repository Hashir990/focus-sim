  /* ---------------- CROSSWORD — the bank ----------------
     30 puzzles: three 15x15s, and nine each at 9x9, 7x7 and 5x5. Built by
     tools/rebuild-bank.py, which drives the shape and fill machinery in
     tools/build-crosswords.py. Not made at runtime: the first version laid
     words across each other in the browser and got sparse, sprawling shapes
     with a handful of crossings.

     922 entries, 711 distinct answers, 675 of them hand-clued. Of the 211
     repeats, 146 are between sizes, which the rules now allow; the other 65
     repeat inside a size, each waiting the required whole game first. Every
     one with a second clue available shows a different one, and the rest are
     single-sense words repeating honestly.

     **The word pool is what decides whether a 15x15 is possible**, and it was
     being throttled by two bugs rather than by any quality rule:

       * `prep()` wrote only WordNet's *first* sense per word, so a word whose
         first gloss ran long or repeated itself was dropped even when its
         second sense was short and plain. It now writes every sense.
       * `word_bank()` dropped any word whose gloss passed MAX_CLUE. `shorten()`
         now cuts the definition down at the first colon, bracket or clause.

     Together those took the pool from 8,033 words to 10,340 — 371 three-letter
     words to 518, and 957 fours to 1,348 — and that is the whole reason a
     fifteen fills at all. Before it, roughly 350 shapes were tried across every
     combination of floor, block count and step budget and not one closed; the
     same shapes filled in about a second from the raw 47,716-word dictionary,
     which is how it was established that the list, not the search, was short.

     Neither fix is complete, and the shortfall is worth knowing: 1,006 words
     still pass every quality test and are dropped anyway, because their glosses
     stay over MAX_CLUE even after shorten() has cut them. At three letters that
     left 437 dictionary words outside the pool. Most are the crosswordese this
     bank exists to avoid, but a hand-picked seventy-five of them — BEE, EEL,
     EWE, OWL, IVY, DEW, DYE, HOE, YAM and the joins and noises a grid needs
     more of than anything else — were clued by hand and took the three-letter
     tier from 509 to 584. That, and nothing else, is what let the *second*
     fifteen close: three letters is where a fully checked grid is tightest,
     because every letter of a three is a crossing letter.

     Most grids are *barred* — entries divided by bars drawn on the edges between
     squares rather than by black squares. They are fully checked: every square
     is in an Across and a Down entry of at least three letters, so there are no
     letters you can only get one way.

     The sevens are solid blocks of letters with no black squares at all. Two of
     the fives are as well, and those two are the whole story of that size: with
     no blocks, every row *and* every column has to be a whole five-letter word.
     That is a double word square, and tools/word-squares.py enumerated the pool
     exhaustively — it holds exactly four, which is two puzzles and their
     transposes. Both are here; there is no third to find, so every five built
     since carries black squares, which is what CW_BLOCKS5 allows. The nines
     and the fifteens keep the blocks BARRED_BLOCKS asks for.

     Four rules govern what is in here, and all of them came from playing it.
     The first two were relaxed on 2026-08-21, when the bank moved from being
     built once to being built daily:

       **An answer waits one whole game before returning at its size.** GAP is
       2: a word in 9x9 #12 may come back at #14, never at #13. It was 4, which
       suited a bank being built toward fifty a size and was far too strict for
       a daily one.

       **Repeats between sizes are allowed.** A word in the day's 5x5 may appear
       in the day's 9x9. Forbidding that is what starved the fill — every size
       needs the commonest short words and there is only one set of them, and it
       is why the fives would not close and the second 15x15 took six attempts.
       Cross-size repetition is still discouraged rather than banned: the fill
       spends least-used answers first, so a word taken by one size goes to the
       back of the queue for the next anyway.

       **Where an answer does come back, the clue changes.** crossClue picks by
       which *appearance* this is rather than by puzzle index — see the note
       there, because the obvious `idx % clues.length` silently fails this rule.

       **Ordinary words, not the far end of the dictionary.** A word has to have
       been met in real text or be one WordNet reaches for to explain other
       words, plus a hand-written ban list. The fifteen reaches much further into
       the short-word list than any other size and so surfaces the tiers fastest:
       it is what caught cock, pee, lea, oft, acc, dec, theta, rhea and actin.

       **Every clue is written by hand, and checked.** A gloss defines the
       *first* sense of a word rather than the one anybody means: ABS came out as
       "a class of composite plastics", COB as an adult male swan, LION as the
       fifth sign of the zodiac. Clues live in tools/cross-clues.py, with phrases
       and people in tools/cross-phrases.py and song lyrics in
       tools/cross-lyrics.py. tools/check-clues.py then asks whether each one is
       answerable rather than merely accurate — it is what found that "Came
       together with" hides MET inside "ca-MET-ogether".

     Size is the only choice. The old easy/medium/hard axis was three word banks,
     and three banks meant the same clues came round within a session.
  */

  const CROSS_CLUES = {
    abandon:'Walk out on for good',
    abc:'American network named for its first letters',
    abdomen:'Belly, in medical terms',
    abet:'Help somebody do wrong',
    able:'Up to the job',
    ably:'Skilfully',
    abort:'Call off a mission before it finishes',
    about:'Roughly, or on the subject of',
    abs:'Stomach muscles you do sit-ups for',
    abuse:'Cruel or improper treatment',
    abyss:'Drop with no bottom to it',
    ace:['Card with a single spot','Serve the other player never touches','Pilot with a string of victories'],
    ache:['Dull steady pain','Long badly for something'],
    acre:'Field measure of 4,840 square yards',
    act:['Do something rather than wait','Part of a play','Put on a manner you do not feel'],
    actor:'Somebody who plays a part on stage',
    acute:'Sharp and severe',
    adapt:'Change to suit new conditions',
    add:'Put one to another',
    adhere:'Stick fast to something',
    ado:'Fuss over nothing much',
    adobe:'Mud brick dried in the sun',
    adore:'Love somebody dearly',
    ads:'Commercials between the programmes',
    afar:'A long way off',
    affair:'A matter being dealt with',
    afraid:'Scared to do it',
    aft:'Towards the back of the ship',
    again:'One more time',
    age:['How old something is','Grow older','Long stretch of history'],
    aged:['Grown old','Left to mature, as cheese'],
    ago:'In the past',
    aha:'Cry when it finally dawns on you',
    aid:'Help given to those who need it',
    aide:'Assistant to somebody important',
    aided:'Helped',
    aides:'Assistants to a politician',
    air:'What you breathe',
    airs:['Put-on grandness','Broadcasts, as a channel does a show'],
    akira:'Director Kurosawa of Rashomon',
    alas:'Sad to say',
    ale:'Beer from a top-fermenting brew',
    ali:'Boxer who floated like a butterfly',
    all:['Every last one','Completely, as in finished'],
    ally:['Country on your side','Friend who backs you up in a fight'],
    alone:['With nobody else','Only that one and no other'],
    alps:'Europe’s best known mountains',
    alt:'Key next to the space bar',
    altar:'Table at the front of a church',
    alto:['Voice below the soprano','Saxophone between soprano and tenor'],
    amd:'Chipmaker that rivals Intel',
    amen:'Word that ends a prayer',
    amended:'Changed for the better',
    amends:'What you make to put a wrong right',
    amino:'___ acid, what protein is built from',
    ammo:'What the magazine holds',
    and:'Word that joins two things',
    anemia:'Shortage of iron in the blood',
    angle:'Corner where two lines meet',
    animal:'Creature that moves about',
    anon:'Author unknown, in short',
    ant:'Small insect in a busy colony',
    ante:'Chips you put in before the cards come',
    anti:'Dead against it',
    any:'One at all, no matter which',
    aol:'Dial-up era giant of the internet',
    ape:['Gorilla or chimpanzee','Copy the way somebody moves'],
    api:'How one program talks to another',
    app:'Program on your phone',
    apt:['Fitting, or inclined to','Quick to learn, as a pupil'],
    arc:'Curve of a bow',
    are:'Be, for more than one',
    area:'Region marked out on a map',
    arena:['Ring the crowd sits around','Field of activity, as in politics'],
    aria:'Solo song in an opera',
    arid:'Too dry for anything to grow',
    arm:'Shoulder to hand',
    armed:'Carrying weapons',
    array:'An impressive spread of things',
    arrive:'Get there at last',
    art:['What hangs in a gallery','Skill you have worked up'],
    asap:'As fast as you possibly can',
    aside:'Off to one side',
    ask:['Put a question','Request as a price'],
    asp:'Snake that finished off Cleopatra',
    asthma:'Condition that leaves you wheezing',
    astral:'Of the stars',
    ate:'Had a meal',
    atm:'Hole in the wall that gives out cash',
    atom:['Smallest piece of an element','Tiniest scrap, as of truth'],
    atomic:'To do with the smallest particles',
    atop:'Right on top of',
    atp:'The men’s tennis tour',
    attend:'Turn up to it',
    attic:'Room right under the roof',
    audi:'German car wearing four rings',
    audio:'The sound half',
    auntie:'Your mother’s sister, fondly',
    ave:'Road, in an address',
    avoid:'Keep well away from',
    away:['Not here','Played at the other team’s ground'],
    awe:'Wonder mixed with respect',
    awed:'Filled with wonder',
    aye:'Yes, in a vote',
    baa:'Sound a sheep makes',
    babe:'Infant still in arms',
    bad:'Not good at all',
    badger:'Pester relentlessly',
    bag:['Something to carry the shopping in','Manage to catch or win one'],
    bailey:'Outer wall of a castle',
    bait:'What you put on the hook',
    bald:'Having lost all one\'s hair',
    bale:'Big bound bundle of hay',
    ball:['Round thing you throw','Grand dance in evening dress'],
    bamboo:'Fast-growing cane a panda eats',
    ban:['Forbid outright','Official order stopping something'],
    banded:'Marked out with stripes',
    bar:['Where the drinks are served','Long straight length of metal'],
    barge:'Flat boat on a canal',
    base:['What a thing stands on','Camp an army works from'],
    based:'Working out of a particular place',
    bat:['What you hit the ball with','Small creature that flies at night'],
    bath:'Long tub you soak in',
    bbc:'British broadcaster known as the Beeb',
    bead:'Little ball on a string',
    bear:'Put up with it',
    beard:'Growth shaved off the chin',
    bed:['Where you sleep','Patch of ground for flowers'],
    bee:'Honey maker in a hive',
    beef:'Meat from cattle',
    beep:'Short sharp electronic note',
    belie:'Give a false impression of',
    belong:'Have your place there',
    belt:'Strap that holds your trousers up',
    bends:'What a diver gets from coming up too fast',
    bespoke:'Made to order for one customer',
    bet:['Stake money on the outcome','Feel fairly sure of it'],
    bias:'A leaning that spoils fair judgement',
    biased:'Leaning one way',
    bib:'What keeps the baby’s front clean',
    bide:'Wait patiently for your time',
    big:'Not small',
    bin:['Where the rubbish goes','Throw out as no longer wanted'],
    bio:'Short life story',
    bit:'Small piece',
    bite:'Take a chunk out of',
    blab:'Give the secret away',
    blasted:'Blown to pieces',
    blend:'Mix smoothly together',
    bling:'Showy jewellery',
    blond:'Fair haired',
    bmw:'German car with a blue-and-white badge',
    boast:'Crow about your own success',
    bob:'Short haircut, or bounce on water',
    bog:'Wet, spongy ground',
    bonus:'Extra on top',
    bony:'All skin and bone',
    boo:['Shout at a bad performance','What you jump out and say','Your sweetheart, informally'],
    booty:'A pirate\'s stolen haul',
    bop:'Hit lightly on the head',
    bot:'Automated account posting online',
    botany:'Study of plants',
    box:'Fight with gloves on',
    bra:'Item of women’s underwear',
    brag:'Boast about yourself',
    bran:'Husks left when grain is milled',
    bud:['A flower before it opens','Pal, in American speech'],
    but:'On the other hand',
    bye:'What you say on the way out',
    cab:'Taxi you hail',
    cabal:'Small group plotting together',
    cad:'Man who treats women badly',
    caesar:'Roman who crossed the Rubicon',
    cafe:'Place for a coffee and a sandwich',
    cam:'Little lens on top of the monitor',
    can:['Tin the drink comes in','Be able to'],
    candid:'Frank and open',
    cane:'Walking stick',
    canine:'One of the pointed teeth',
    canopy:'Cover stretched overhead for shade',
    cap:['Hat with a peak','Top for a bottle','Upper limit on spending','A lie, in modern slang'],
    car:'What sits in the garage',
    care:'Look after somebody',
    career:'Your working life',
    cast:'The actors in a play',
    caste:'Fixed social rank one is born into',
    cat:['Pet that purrs','Tiger or lion, broadly'],
    cater:'Provide the food for an event',
    caucus:'Party members meeting behind closed doors',
    cent:'Hundredth of a dollar',
    cfo:'The money boss in a company',
    chain:'Links joined in a line',
    chase:'Run after',
    chat:'Easy talk about nothing much',
    chef:'The one in the kitchen whites',
    chili:'Hot little pepper',
    chip:'Small piece knocked off',
    cia:'American foreign intelligence agency',
    cite:'Quote as your source',
    clam:'Shellfish that shuts tight',
    clan:'Family group',
    cnn:'American round-the-clock news network',
    coat:'Layer of paint',
    cob:'What sweetcorn comes on',
    coke:'Fizzy cola drink',
    cola:'Fizzy brown drink',
    con:'Swindle someone',
    cope:'Manage to get through it',
    cpr:'Chest compressions to restart a heart',
    cpu:'The chip that does the thinking',
    crafty:'Sly, and rather clever with it',
    crag:'Steep rough rock',
    cramp:'Sudden painful tightening of a muscle',
    crash:'Come down hard, as a computer might',
    creator:'The one who made it',
    crow:'Big black bird with a harsh call',
    crux:'The heart of the matter',
    cry:'Shed a few tears',
    cube:'Multiply a number by itself twice',
    cue:'Signal to begin',
    cup:'You drink your tea from it',
    cyst:['Small fluid-filled lump under the skin','Harmless growth a surgeon may drain'],
    dad:'Father',
    daft:'Silly, in a harmless way',
    dale:'Broad valley between hills',
    dam:'Wall built to hold a river back',
    damn:'Mild curse',
    damon:'Actor Matt, Jason Bourne and the man left on Mars',
    dash:'Short sprint',
    data:'Facts you work from',
    date:'Day on the calendar, or an evening out',
    deck:'Floor of a ship',
    deep:['A long way down','Profound, as a remark'],
    defy:'Refuse to obey',
    deli:'Counter selling cold meats and cheeses',
    demo:'Show of how a thing works',
    den:['Small private room','Wild animal’s hideout'],
    dent:'Small hollow left by a knock',
    deport:'Send back out of the country',
    deter:'Put somebody off doing it',
    devil:'The one with the horns',
    did:'Carried out the deed',
    die:['Stop living','Cube with spots, one of a pair'],
    din:'Racket that makes you raise your voice',
    dip:'Brief plunge in the pool',
    dire:'About as bad as it gets',
    diva:'Leading lady of the opera',
    dna:'The double helix',
    doc:'The one you see when you\'re ill',
    doe:'Female deer',
    dog:'Pet that fetches',
    dogma:'Belief laid down as fact',
    doll:'Toy in the shape of a child',
    dot:['Small round mark','Bang on time, on the ___'],
    drama:'A play, or a fuss',
    drew:['Made a picture','Ended level, with neither side winning'],
    drool:'Let the saliva run out',
    dub:'Give a new name to',
    dude:'Bloke, in American slang',
    dummy:'Shop window figure',
    dung:'What the farmer spreads on the field',
    duo:'Pair who perform together',
    dye:'Change the colour of cloth',
    dyed:'Coloured with a soaking',
    dyer:'One who colours cloth for a living',
    each:'Every one on its own',
    eager:'Keen and impatient to start',
    ear:'What you listen with',
    earl:'British peer below a marquess',
    earn:'Get paid for the work',
    earned:'Worked for and got',
    earth:'The planet under your feet',
    ease:['Absence of effort','Make the pain less'],
    eats:'Has a meal',
    ebay:'Online auction site',
    ecg:'Trace of the heartbeat',
    echo:'Sound bouncing back',
    eclipse:'When the moon blots out the sun',
    eddy:'Small whirl in a stream',
    edge:'The very rim of something',
    edgy:['On edge','Daringly new'],
    edict:'Order handed down from on high',
    egg:'What the hen lays',
    eggs:'Boxful from the hens',
    ego:['Your sense of yourself','Far too high an opinion of yourself'],
    elapse:'Pass, as time does',
    elder:'Older of the two',
    element:'One part of the whole',
    eleven:['A football team’s worth','One more than ten'],
    elf:'Small creature of folk tales',
    elm:'Tall tree lost to disease',
    email:'Message sent to an inbox',
    embark:'Go aboard, or make a start',
    emerge:'Come into view',
    emo:'Gloomy guitar music of the 2000s',
    enamel:'Hard glossy coating',
    end:['Finish','The far tip of something','Bring something to a stop'],
    ended:'Finished and over',
    endemic:'Found only in one region',
    endure:'Bear it, or last',
    energy:'What you need to keep going',
    ensure:'Make certain of something',
    enter:'Go in',
    epa:'American environment agency',
    epic:['Long heroic tale','Huge in scale'],
    era:['A long stretch of history','Period named after who ran it'],
    erase:'Rub out',
    err:'Get it wrong',
    error:'A mistake in the working',
    erupt:'Burst out, as a volcano does',
    eta:'When you are expected to arrive',
    etc:'And so on, in short',
    eve:'The night before a big day',
    even:['Flat and level','Divisible by two'],
    ewan:'Actor McGregor of Trainspotting',
    extra:'One more, on top of what you had',
    eye:['What you see with','Hole in a needle'],
    eyed:'Looked at carefully',
    eyes:['The pair of them','Looks hard at'],
    faa:'American aviation regulator',
    fab:'Great, in sixties slang',
    fail:'Not manage it',
    fair:'Just, or fine weather',
    fake:'Not the real thing',
    fall:'Come down suddenly',
    false:'Not true at all',
    fan:'One who follows the team',
    fbi:'American federal investigators',
    fda:'American food and drug regulator',
    fedora:'Felt hat with a creased crown',
    felony:'A serious crime in US law',
    film:'What you go to the cinema for',
    filming:'Shooting the scenes',
    final:'The very last one',
    fitting:'Suitable, and rather apt',
    flat:'Rooms on one floor of a building',
    flee:'Run for it',
    forum:'Place where people argue it out',
    fuel:'What you burn to get power',
    fun:'A good time',
    funny:'Makes you laugh',
    gag:'Joke, or something over the mouth',
    gal:'Girl, informally',
    gala:'Grand festive occasion',
    gap:['Space between','Break between two lessons'],
    gas:['Neither solid nor liquid','What you put in the car, in America'],
    gcse:'British exam taken at sixteen',
    gdp:'Measure of a country’s output',
    gem:['Precious stone','Somebody really rather good'],
    gen:'The facts on something, informally',
    general:'True in most cases, or an army officer',
    gent:'Chap, politely',
    get:'Come to have',
    girl:'Young woman or child',
    git:'Version control system programmers use',
    glance:'Quick look',
    gmt:'The clock the world sets its watch by',
    god:'A being that is worshipped',
    gore:'Blood spilled in a horror film',
    gorilla:'Largest of the apes',
    gps:'Satellite navigation',
    grease:'Thick oil for the moving parts',
    guilt:'What you feel afterwards',
    gum:'Chew it, or what holds the stamp on',
    handed:'Passed over by hand',
    has:'Owns, right now',
    haste:'Hurry that makes waste',
    hated:'Could not stand it',
    haul:'Drag something heavy along',
    haven:'Safe place to shelter',
    hay:'Dried grass for the animals',
    hbo:'Network behind The Sopranos',
    heed:'Pay attention to',
    heist:'Robbery with a plan behind it',
    hello:['First word on the phone','"___, is it me you’re looking for"'],
    hen:'Female bird in the coop',
    heretic:'One who defies church doctrine',
    hero:'The one you look up to',
    heroic:'Brave beyond the call of duty',
    hey:'Call to get attention',
    high:'A long way up',
    hive:'Where the bees are kept',
    hobo:'Wanderer who rides the trains',
    hope:'What you hold on to',
    hot:'Straight from the oven',
    hours:'Sixty minutes each',
    hue:'Shade of colour',
    hug:'Squeeze with both arms',
    ibm:'Big Blue of the computing world',
    ice:'Frozen water',
    icon:'Little picture you tap',
    iconic:'Instantly known as a symbol',
    icu:'Ward for the sickest patients',
    icy:['Covered in frost','Distinctly unfriendly in manner'],
    idea:['Something you think of','The point of the whole thing'],
    ideal:'Could not be better',
    idler:'One who does no work',
    idol:'Star that fans adore',
    ifs:'Doubts and conditions',
    ignite:'Set it alight',
    ikea:'Swedish flatpack furniture giant',
    ill:['Not well','Harm or misfortune'],
    imam:'Man who leads prayers in a mosque',
    imp:['Small mischievous sprite','Cheeky little child'],
    impetus:'The push that gets it going',
    inaway:'Sort of, if you look at it like that',
    inch:'Twelfth of a foot',
    indirect:'Roundabout, not straight to the point',
    ion:'Atom carrying a charge',
    iou:'Scribbled note promising to pay you back',
    irs:'The American taxman',
    isp:'Company that sells you internet',
    itv:'The Beeb’s commercial rival',
    keg:'Small barrel',
    kept:'Held on to',
    kfc:'The Colonel’s fried chicken chain',
    kgb:'Soviet secret police',
    kill:'Put an end to it',
    kilo:'A thousand grams',
    knee:'Joint halfway down the leg',
    lab:['Where experiments are done','Retriever, for short'],
    lace:'Delicate openwork fabric',
    lad:'Young boy',
    lam:'Flight from the law',
    lament:'Song of mourning',
    lan:'Small network inside one building',
    late:'Not on time',
    latte:'Coffee with a lot of hot milk',
    leaf:'Green thing on a tree',
    lean:'Prop yourself against something',
    lee:'The sheltered side',
    lei:'Hawaiian garland of flowers',
    lens:'Glass that bends light in a camera',
    lent:['Let somebody borrow it','The forty days before Easter'],
    liable:'On the hook for it legally',
    liar:'One who does not tell the truth',
    library:'Where the books are borrowed',
    lie:['Untruth','Stretch out flat'],
    lilac:'Pale purple, or the shrub it comes from',
    limit:'As far as it goes',
    lion:'Big cat with a mane',
    list:'Items written one below another',
    load:'What the lorry is carrying',
    lob:'Hit the ball high and gently',
    lobe:'Rounded part of an ear or brain',
    loco:'Crazy, in slang',
    loiter:'Hang about with no purpose',
    lol:'Text shorthand for laughing',
    loo:'The toilet, in Britain',
    lore:['Old knowledge passed down','Backstory a fandom knows by heart'],
    lose:'Fail to keep',
    mac:'Raincoat, or an Apple computer',
    mace:'Spiked club of a medieval knight',
    mad:['Angry, or out of your mind','Wildly enthusiastic about something'],
    malt:'Grain used for brewing',
    mam:'Mother, in the north of England',
    mama:'Mother',
    man:'Grown male',
    manor:'The big house on a country estate',
    mantra:'Phrase repeated over and over',
    map:['Sheet showing where places are','Plan the route out in full'],
    mar:'Spoil the look of it',
    mare:'Horse that is not a stallion',
    marine:'To do with the sea',
    mat:['Small rug at the door','Padded floor for the gymnasts'],
    mba:'Business degree for future managers',
    med:'School where doctors train, informally',
    meh:'Sound of complete indifference',
    memo:'Short note sent round the office',
    mere:'Only that, and nothing better',
    merry:'Cheerful, and probably singing',
    mesa:'Flat topped hill with steep sides',
    messiah:'The promised deliverer',
    mini:'Very short skirt of the sixties',
    minor:'Under the legal age',
    mlb:'Baseball league in the States',
    moan:'Low sound of complaint',
    mob:['Unruly crowd','Crowd round somebody in numbers'],
    mods:'Changes players make to a game',
    moo:'What the cow says',
    most:'The greatest amount',
    mover:'One of the pair carrying the sofa',
    mph:'How fast, on a road sign',
    mri:'Hospital scan done inside a tube',
    mtv:'Channel that once played music videos',
    mud:'Wet earth',
    nab:'Catch red-handed',
    nag:'Keep on at somebody',
    nail:'Hammer this into wood',
    naive:'Too trusting for your own good',
    narnia:'Land through the back of the wardrobe',
    nasa:'The American space agency',
    nay:'Old-fashioned no',
    nba:'Basketball league in the States',
    near:'Close by',
    neither:'Not one and not the other',
    net:'What the goalkeeper stands in',
    never:'Not at any time',
    new:['Just made','Unfamiliar, as in the job'],
    next:'The one after this',
    nfl:'American football league',
    nhs:'British health service',
    nil:'Nothing at all, on a scoreboard',
    nip:'Small sharp bite',
    node:'Point where lines meet',
    now:'At this moment',
    nsa:'American signals intelligence agency',
    nth:'Last in a very long series',
    null:'Amounting to nothing at all',
    nyc:'The Big Apple, in short',
    oak:['Tree that drops acorns','Hard wood for good furniture'],
    oar:'What you row with',
    oath:['Solemn promise','Swear word said in anger'],
    obese:'Medically very overweight',
    odd:['Strange, or not even','Left over from a pair'],
    odds:['Chances of it happening','What you are at when you disagree'],
    ode:'Poem of praise',
    ogre:'Man eating giant of fairy tales',
    oldman:'Actor Gary, Sirius Black and Churchill on screen',
    once:['One time only','Long ago, in the old days'],
    one:['The first number','A single item'],
    only:'And nothing else',
    onset:'The very beginning of it',
    opaque:'You cannot see through it',
    ops:'Military operations, for short',
    opt:'Choose one over the other',
    optic:'To do with the eye',
    oral:['Spoken rather than written','To do with the mouth'],
    ore:'Rock you get metal out of',
    oval:'Egg-shaped',
    oven:'Where the roast goes',
    overt:'Done openly, not hidden',
    ovum:'Egg cell',
    panda:'Black and white bear of China',
    pant:'Breathe hard after running',
    papal:'To do with the Pope',
    pat:['Light tap','Small slab of butter'],
    paw:['An animal’s foot','Handle roughly with the hands'],
    pbs:'American public television',
    pdf:'Document format that never reflows',
    pea:'Small green vegetable in a pod',
    peace:'No war',
    peach:'Fuzzy stone fruit',
    pearl:'Gem that grows in an oyster',
    peel:['Skin of an orange','Take the skin off a potato'],
    peg:['Pin for hanging a coat on','What holds the washing on the line'],
    pink:'Pale red',
    place:'Spot where something is',
    plain:'Flat open stretch of country',
    plan:'What you mean to do',
    plug:'Stopper, or what goes in the socket',
    poise:'Calm, balanced self-control',
    polls:'Where you go to vote',
    pony:'Small horse',
    pop:['Chart music','Fizzy drink, in the American Midwest'],
    potion:'Drink brewed to work magic',
    pray:'Speak to a god',
    prior:'Coming before',
    pry:['Lever open, or nose about','Nose into what is not your business'],
    pta:'School group of parents and teachers',
    pulp:'Soft wet mass',
    rabid:'Foaming at the mouth',
    raft:'Flat boat of lashed logs',
    rag:['Old scrap of cloth','Tease somebody without mercy'],
    raise:'Lift it up',
    ram:'Male sheep, or shove hard',
    rand:'South African currency',
    rap:['Sharp knock, or spoken-word music','Rhymed music over a beat'],
    ray:'Beam of light',
    rayon:'Silky cloth made in a factory',
    readily:'Without hesitation',
    reap:'Bring in the harvest',
    red:'Colour of a post box',
    redo:'Do it over again',
    ref:'One who blows the whistle',
    rely:'Count on somebody',
    rep:'A salesman out on the road',
    reset:'Put back to the starting state',
    restore:'Bring it back to how it was',
    reuse:'Put it to work a second time',
    rib:'Bone in the chest, or tease gently',
    rid:'Free of something',
    rise:['Go up','Get out of bed in the morning'],
    risen:'Come up, as bread or the sun has',
    road:['Way from town to town','"Take me home, country ___s"'],
    rob:'Take what is not yours',
    roe:'Fish eggs eaten as a delicacy',
    root:'Part of the plant underground',
    rot:['Go bad','Utter nonsense'],
    route:'Way you take to get there',
    rover:'One who wanders, or a Mars vehicle',
    rum:'Spirit made from sugar cane',
    rural:'Of the countryside',
    rut:['Dull routine you cannot escape','Deep groove worn by wheels'],
    rye:'Grain used in bread and whisky',
    sac:'Small bag inside a body',
    sack:'Big rough bag, or dismissal',
    sag:'Droop in the middle',
    sagan:'Astronomer Carl who presented Cosmos',
    sale:'When the shop drops its prices',
    sands:'What the beach is made of',
    sane:'In your right mind',
    sap:['Juice inside a plant','Drain the strength from'],
    sat:'Took a seat',
    satin:'Smooth shiny cloth',
    saw:'Tool with teeth',
    scale:'Range from small to large',
    scam:'Swindle dressed up as a deal',
    scar:'Mark a wound leaves behind',
    scarce:'In very short supply',
    scare:'Sudden fright',
    scared:'Frightened by something',
    sea:['Where the rivers all end up','Salt water between two coasts'],
    sec:'Just a moment',
    seizure:'A sudden convulsive fit',
    set:['Put in place','Matching group of things','Where a film is shot'],
    share:'Divide it between you',
    she:'That woman',
    shrug:'What the shoulders say',
    shun:'Deliberately keep away from',
    shy:'Uneasy with people',
    sing:'Carry a tune',
    singer:'One who performs a song',
    sip:'Small mouthful',
    sir:['How you address a man politely','Title a knight is given'],
    skinned:'With the skin removed',
    sky:'What the clouds are in',
    slab:'Thick flat slice',
    sled:'What you ride down a snowy hill',
    slump:'Fall sharply in value',
    sly:'Cunning',
    sms:'Text message, formally',
    snow:'White flakes falling in winter',
    soar:'Climb high and fast',
    soy:'Bean in the sauce',
    spite:'Petty desire to hurt someone',
    square:'Four equal sides',
    ssd:'Drive with no moving parts',
    stag:['Male deer','Party for a man before his wedding'],
    stan:'Obsessive fan of a celebrity',
    stays:'Remains where it is',
    stem:['Stalk holding up a flower','Come from, as trouble does'],
    step:'One tread of the stairs',
    stray:'Wander off the path',
    strut:'Walk with a proud swagger',
    sty:'Where the pigs live',
    swami:'Hindu religious teacher',
    tad:'Just a little bit',
    tan:['The colour the sun leaves','Turn hide into leather'],
    tang:'Sharp taste that catches you',
    tar:'Black stuff on the road',
    tee:'Where a golf hole begins',
    teen:['Somebody between twelve and twenty','"Smells Like ___ Spirit"'],
    tell:'Let someone know',
    test:'Exam to find out what you know',
    tester:'One who tries a product out',
    theater:'Where a play is staged',
    theme:'Idea running through it',
    then:'At that time',
    tie:['Fasten with a knot','Match that ends level','Neckwear for a suit'],
    tied:['Fastened with a knot','Level at the final whistle'],
    tnt:'Explosive stacked in cartoons',
    toe:'Digit on the foot',
    top:['Highest part of it','Garment worn above the waist'],
    tot:'Very small child',
    toyota:'Japanese maker of the Corolla',
    trade:'Swap, or the business of swapping',
    trainee:'Someone learning on the job',
    tremor:'Small shake of the ground',
    trend:'Which way things are going',
    trick:'A cunning deception',
    truly:'Really',
    tucker:'Bush grub, in Australia',
    tutor:'Teacher of one pupil at a time',
    twenty:'Two tens',
    twig:'Small branch',
    ugly:'Hard on the eye',
    ultra:'Beyond, as a prefix',
    undo:['Put back as it was','Unfasten a button'],
    undue:'More than is called for',
    uni:'Where students go after school',
    unit:'One of a set',
    url:'Address you type into a browser',
    usa:'The States, in short',
    used:'Second-hand',
    user:'The person a product is made for',
    vain:'Far too pleased with your looks',
    van:'Small delivery lorry',
    verb:'Doing word',
    vermeer:'Painted the girl with the pearl earring',
    veto:'Block it outright',
    via:'By way of',
    vicar:'Parish clergyman',
    vie:'Compete',
    wade:'Walk through shallow water',
    wary:'Careful, and not quite trusting',
    was:'Used to be',
    way:'Route, or a manner of doing',
    wed:'Marry',
    whim:'Sudden idea with no reason behind it',
    wit:'A sharp sense of humour',
    wits:'Your quick thinking',
    woe:'Deep sorrow',
    wooden:'Made of timber, or stiff in manner',
    yank:'Pull hard and sharply',
    yarn:'Wool for knitting, or a tall tale',
    yawn:'What you do when tired',
    yeet:'Hurl something with great force',
    yet:'All the same, even so',
    yuan:'Chinese money',
    zap:'Hit with a beam',
  };

  /* A puzzle is one of two shapes, and crossParse() below is the
     only thing that knows the difference.

       * Black-square: an array of rows, '#' where a wall is.
       * Barred: {r, v, h}. Every square is a letter; the entries
         are divided by bars on the square edges. v[r][c] is a bar
         on the left edge of square (r,c), h[r][c] one on its top
         edge, so v column 0 and h row 0 are always 0 — the outside
         of the grid is a border, not a bar.

     Entries and clue numbers are worked out from the shape at
     runtime — storing them would be storing something derivable. */
  const CROSS_GRIDS = [
    {r:['#ace#dub#adhere','scar#one#loiter','shrugliablegala','deepultra##hay#','##atm###ref#lab','cob##can#marine','ape##age#enamel','eats#rover#memo','square#egg##din','auntie#roe##gag','red#bra###gal##','#bog##capbagarc','macchatbeepanon','biased#lee#icon','attend#elf#net#'],
     v:['000000000000000','000000000000000','000001000001000','000010000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000100100','000100010001000','000000000000000','000000000000000'],
     h:['000000000000000','000000000000000','000000000000000','000000000000100','001000000000010','000000000000000','000000000000100','000000000000000','001000000000000','000000000000100','000000000000000','010000000000000','001000000000000','000000000000000','000000000000000']},
    {r:['##abc##aha#each','altarabdomencpu','woodenlobendure','elm#ate#onset##','#fitting#dude##','#echo#deter#pbs','idler##node#loo','moan##bee##data','art#afar##vicar','mat#final#even#','##earl#library#','##drama#mam#app','swamiignitecite','hatedneithersag','eyed#gdp##rye##'],
     v:['000000000000000','000001000000100','000000100100000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000001000001000','000001000000100','000000000000000'],
     h:['000000000000000','000000000000000','000000000000000','000000000000000','010000000000000','000000000000100','001000000000000','000000000000000','000000000000000','000000000000000','000000000000100','001000000000010','000000000000000','000000000000000','000000000000000']},
    {r:['##eclipse#abs##','heroicatticmesa','elapsepeacewits','reset#ammo##zap','eve##plain#fun#','tester#uni#err#','inaway#doc#lei#','cater#air#boast','#bin#sky#singer','#ant#cia#toyota','#nay#array##mri','ads##rand#chain','poisecanopyonce','indirectbespoke','##epa#theater##'],
     v:['000000000000000','000000100001000','000000100001000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000000000000000','000001000001000','000000001000000','000000000000000'],
     h:['000000000000000','000000000000000','000000000000000','000000001000000','000000010000000','001000000000010','000000000000000','010000000000100','000000010000000','000000000000010','001000000000100','000000000000000','000000110000000','000000000000000','000000000000000']},
    {r:['#slab#ace','chili#mac','fuelbling','only#one#','#rag#bob#','#amd#step','byepatant','ion#panda','tnt#eggs#'],
     v:['000000000','000000000','000010000','000000000','000000000','000000000','000100100','000000000','000000000'],
     h:['000000000','000000000','000000000','001000000','010100010','000001100','000000000','000000000','000000000']},
    {r:['act#defy#','duo#ended','opticdata','#sack#mad','#cry#gas#','tar#pant#','aridultra','devil#rap','#deep#ali'],
     v:['000000000','000000000','000001000','000000000','000000000','000000000','000010000','000000000','000000000'],
     h:['000000000','000000000','000000000','011000110','000000000','000000000','000000000','000000000','000000000']},
    {r:['##ago#peg','mereadore','twentytan','van#heist','#nab#roe#','damon#nag','anonangle','staysfilm','hen#alt##'],
     v:['000000000','000010000','000000100','000000000','000000000','000000000','000010000','000001000','000000000'],
     h:['000000000','000000000','000000000','000000000','000000000','011000010','000000100','000000000','000000000']},
    {r:['#ban##tie','ponymerry','epicobese','atm#sands','craftyden','hello#cpu','embarklol','routeearl','art##gmt#'],
     v:['000000000','000010000','000010000','000000000','000000100','000000000','000000100','000001000','000000000'],
     h:['000000000','000000000','000000000','010000010','000000001','000010100','101000000','000000000','000000000']},
    {r:['cast#crag','asthmaabc','direabyss','#damn#age','#eyefair#','cat#aide#','hueoldman','idealease','pink#drew'],
     v:['000000000','000000100','000010000','000000000','000010000','000000000','000100000','000001000','000000000'],
     h:['000000000','000000000','000000000','000000110','000010000','011000000','000000100','000000000','000000000']},
    {r:['ace#babe#','handedarc','amendsmri','#bra##bot','rag###ore','any##cob#','fdaaffair','tellbooty','#deli#lee'],
     v:['000000000','000000100','000000100','000000000','000000000','000000000','000100000','000010000','000000000'],
     h:['000000000','000000000','000000000','010000000','000000000','000000010','001000100','000000000','000000000']},
    {r:['abc##dip#','baa#aides','singideal','#liar#are','lens#bald','aye#nail#','candiddoe','email#ecg','#dye##dog'],
     v:['000000000','000000000','000010000','000000000','000000000','000000000','000000100','000000000','000000000'],
     h:['000000000','000000000','000000000','000000000','000000100','000000010','011000000','000000000','000000000']},
    {r:['ace##cafe','faa#rabid','tuckeruni','#chef#sac','dung#belt','usa#bead#','mribadger','mover#emo','yeet##dot'],
     v:['000000000','000000000','000000100','000000000','000000000','000000000','000100000','000000000','000000000'],
     h:['000000000','000000000','000000000','000000000','001000000','000000110','010000000','000000000','000000000']},
    {r:['#blab#abc','prior#baa','ballavoid','sea#girl#','#act#ate#','#road#aye','endnarnia','red#tutor','ads#amen#'],
     v:['000000000','000000000','000010000','000000000','000000000','000000000','000100000','000000000','000000000'],
     h:['000000000','000000000','000000000','010000000','000000000','001000100','000000010','000000000','000000000']},
    {r:['aptmama','failrut','awebide','ridsane','skinned','memobag','sapwary'],
     v:['0001000','0000100','0001000','0001000','0000000','0000100','0001000'],
     h:['0000000','0000000','0000000','0101011','1010100','0000000','0000000']},
    {r:['whimbar','ibmbase','topalas','viekept','antiboo','iculiar','nhsogre'],
     v:['0000100','0001000','0001000','0001000','0000100','0001000','0001000'],
     h:['0000000','0000000','0000000','1101000','0000110','0000000','0000000']},
    {r:['bbceach','oralwoe','gapfake','kfcdyed','illammo','leafpop','lenthot'],
     v:['0001000','0000100','0001000','0001000','0001000','0000100','0000100'],
     h:['0000000','0000000','0000000','1111000','0000111','0000000','0000000']},
    {r:['miniask','odetwig','boxverb','altodam','binveto','losegod','yuanops'],
     v:['0000100','0001000','0001000','0000100','0001000','0000100','0000100'],
     h:['0000000','0000000','0000000','1001011','0110100','0000000','0000000']},
    {r:['gorilla','ovumair','ramatom','element','scamcue','earairs','cnnmalt'],
     v:['0000000','0000100','0001000','0000000','0000100','0001000','0001000'],
     h:['0000000','0000000','0000000','0010001','1101110','0000000','0000000']},
    {r:['blababc','robable','arealan','getcyst','absoath','hasknee','addeddy'],
     v:['0000100','0001000','0000100','0001000','0001000','0001000','0001000'],
     h:['0000000','0000000','0000000','0001000','1110101','0000000','0000000']},
    {r:['aceache','viaload','etcplug','mehsale','actalas','coatale','endemic'],
     v:['0001000','0001000','0001000','0001000','0001000','0000100','0000000'],
     h:['0000000','0000000','0000000','1000000','0111111','0000000','0000000']},
    {r:['abcugly','biaspea','lobesaw','eyedcnn','wadeusa','andabet','skyreap'],
     v:['0001000','0000100','0000100','0000100','0000100','0001000','0001000'],
     h:['0000000','0000000','0000000','0110100','1001011','0000000','0000000']},
    {r:['ariaabs','messiah','mappray','oddasap','liareta','allicon','dyedgmt'],
     v:['0000100','0000000','0001000','0001000','0000100','0001000','0000100'],
     h:['0000000','0000000','0000000','0011011','1000100','0000000','0000000']},
    ['share','cabal','avoid','reuse','enter'],
    {r:['#bat#','hours','undue','guilt','#soy#'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['#fab#','polls','drool','funny','#med#'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['#crow','#hive','based','user#','dent#'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['#abs#','scale','strut','dogma','#rep#'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['#abc#','ideal','false','spite','#tee#'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['abet#','bear#','sagan','#redo','#drew'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['ache#','bran#','caste','#stem','#hero'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},
    {r:['acre#','crux#','earth','#mare','#plan'],
     v:['00000','00000','00000','00000','00000'],
     h:['00000','00000','00000','00000','00000']},

  ];

  /** The letter rows of a puzzle, whichever of the two shapes it is stored in. */
  function crossRows(g){ return Array.isArray(g) ? g : g.r; }

  /** Walk a grid and work out its entries, numbers and answers.

      A wall and a bar are the same thing to a solver — a place an entry stops —
      so both collapse into `cutL` / `cutT` here and the rest of the walk is
      shared. `cutL(r,c)` asks "is there a break immediately left of this
      square", which is true at a black square, at a bar, and at the grid edge. */
  function crossParse(g){
    const rows = crossRows(g), n = rows.length;
    const bars = Array.isArray(g) ? null : g;
    const wall = (r,c)=> r<0 || c<0 || r>=n || c>=n || rows[r][c] === '#';
    const cutL = (r,c)=> c<=0 || wall(r,c-1) || (!!bars && bars.v[r][c] === '1');
    const cutT = (r,c)=> r<=0 || wall(r-1,c) || (!!bars && bars.h[r][c] === '1');
    const entries = [];
    let num = 0;
    for(let r=0;r<n;r++) for(let c=0;c<n;c++){
      if(wall(r,c)) continue;
      // an entry starts here if it cannot come in from behind and has somewhere
      // to go — a single square between two breaks is not an entry
      const startA = cutL(r,c) && !wall(r,c+1) && !cutL(r,c+1);
      const startD = cutT(r,c) && !wall(r+1,c) && !cutT(r+1,c);
      if(!startA && !startD) continue;
      num++;
      if(startA){
        const cells = [];
        for(let k=c; k<n && !wall(r,k) && (k===c || !cutL(r,k)); k++) cells.push([r,k]);
        entries.push({num, dir:'A', cells, answer:cells.map(([y,x])=>rows[y][x]).join('')});
      }
      if(startD){
        const cells = [];
        for(let k=r; k<n && !wall(k,c) && (k===r || !cutT(k,c)); k++) cells.push([k,c]);
        entries.push({num, dir:'D', cells, answer:cells.map(([y,x])=>rows[y][x]).join('')});
      }
    }
    return {n, rows, entries, bars};
  }

  /** The clue for an answer, in the puzzle at index `idx`.

      An answer that has to come back somewhere in the bank is given more than
      one clue rather than the same one twice, so meeting it again reads as a
      fresh question instead of a rerun. Those answers hold an array; picking by
      puzzle index rather than at random keeps a given puzzle's clue stable
      across reloads, which matters because progress is saved against it. */
  /** Which appearance of `answer` the puzzle at `idx` is: 0 for the first, and
      so on. Built once on demand by walking the bank, because it is the only
      way crossClue can tell "this answer's second outing" from "puzzle 2". */
  let _turns = null;
  function crossClueTurn(answer, idx){
    if(!_turns){
      _turns = new Map();
      for(let i = 0; i < CROSS_GRIDS.length; i++){
        const seen = new Set();
        for(const e of crossParse(CROSS_GRIDS[i]).entries){
          if(seen.has(e.answer)) continue;
          seen.add(e.answer);
          let m = _turns.get(e.answer);
          if(!m) _turns.set(e.answer, m = new Map());
          if(!m.has(i)) m.set(i, m.size);
        }
      }
    }
    const m = _turns.get(answer);
    const t = m && m.get(idx | 0);
    return t === undefined ? 0 : t;
  }

  function crossClue(answer, idx){
    const c = CROSS_CLUES[answer];
    if(!c) return answer;
    if(!Array.isArray(c)) return c;
    // By *which appearance this is*, not by `idx % c.length`.
    //
    // The raw modulo looks right and quietly fails the "where an answer comes
    // back, the clue changes" rule, because puzzle indices are not random: the
    // bank is emitted 15x15 first, then the nines, sevens and fives, so an
    // answer shared between the fifteen at index 0 and a nine at index 2 lands
    // on the same parity and shows the identical clue twice. Measured on the
    // 2026-08-21 bank, 24 of 33 repeated answers collided that way. Hashing the
    // index first was tried and is worse — with two clues and two puzzles a
    // hash still collides half the time, and it took the count to 28.
    //
    // Counting appearances is the only thing that actually guarantees it: the
    // first puzzle to use an answer gets clue 0, the second gets clue 1, and so
    // on. Still a pure function of the bank's contents, so a given puzzle always
    // shows the same clue and saved progress stays valid.
    return c[crossClueTurn(answer, idx) % c.length];
  }

  /** A name for a puzzle that comes from the puzzle itself.

      **Never key saved progress on a puzzle's position in CROSS_GRIDS.** New
      puzzles are added inside their size group rather than at the end, so an
      index is not a stable name for anything — insert one 9x9 and every 7x7
      and 5x5 after it shifts down. Progress used to be stored against the
      index, and the effect of a single insertion was that half-solved letters
      were loaded into whichever puzzle had moved into that slot: grids opening
      pre-filled with another puzzle's answers, revealed squares contradicting
      the clue, puzzles marked finished that had never been opened.

      Hashing the grid means the name travels with the content. Two hashes
      rather than one, and the size on the front, because a collision here does
      not look like a collision — it looks like the bug above coming back. */
  function crossKey(g){
    const rows = crossRows(g);
    let s = rows.join('|');
    if(!Array.isArray(g)) s += '|' + g.v.join('') + '|' + g.h.join('');
    let a = 0x811c9dc5, b = 0x01000193;
    for(let i=0;i<s.length;i++){
      const ch = s.charCodeAt(i);
      a = Math.imul(a ^ ch, 0x01000193) >>> 0;
      b = Math.imul(b + ch, 0x85ebca6b) >>> 0;
    }
    return rows.length + '-' + a.toString(36) + b.toString(36);
  }

  /** Puzzle indices at a given size, so a session can walk through them. */
  function crossAtSize(n){
    const out = [];
    for(let i=0;i<CROSS_GRIDS.length;i++) if(crossRows(CROSS_GRIDS[i]).length === n) out.push(i);
    return out;
  }
