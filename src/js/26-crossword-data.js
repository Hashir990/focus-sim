  /* ---------------- CROSSWORD: word & clue banks ----------------
     Puzzles are generated at run time from these lists, so every answer is a real
     word with a clue that matches it. Grids are always 9x9, so nothing here may be
     longer than 9 letters.

     Three clue styles, mixed together the way a newspaper puzzle does it:
       plain      ['RIVER','Water flowing to the sea']
       anagram    ['REGENT','N greet (anag.)']     <- fodder must be a true anagram
       abbrev.    ['ETC','Et cetera (abbr.)']

     The anagram fodder is checked automatically by `npm test`: the letters before
     "(anag.)" must be a genuine rearrangement of the answer. Add a wrong one and
     the test fails rather than the puzzle shipping broken.

     The short entries matter as much as the showy ones — 3 and 4 letter words are
     what let the generator interlock everything inside 9x9. */
  const CROSS_BANK = {
    easy: [
      // --- short connectors ---
      ['ICE','Frozen water'],
      ['SEA','Salty expanse'],
      ['SUN','It rises in the east'],
      ['CAT','Purring pet'],
      ['EAR','You hear with it'],
      ['OAK','Sturdy tree'],
      ['ARM','Shoulder to hand'],
      ['EGG','It comes before the chicken, or after'],
      ['INK','Pen filler'],
      ['OWL','Nocturnal bird'],
      ['TEA','Brewed drink'],
      ['ETC','Et cetera (abbr.)'],
      ['ATM','Cash machine (abbr.)'],
      ['DIY','Do it yourself (abbr.)'],
      ['VIP','Important person (abbr.)'],
      ['DNA','Genetic material (abbr.)'],
      // --- four and five ---
      ['DOOR','You open it to enter'],
      ['MOON','It orbits the Earth'],
      ['RAIN','Water from clouds'],
      ['SNOW','White winter fall'],
      ['STAR','It twinkles at night'],
      ['TREE','It has bark and leaves'],
      ['WIND','Moving air'],
      ['BOOK','You read it'],
      ['FIRE','It burns'],
      ['LAKE','Inland water'],
      ['NEST','Bird’s home'],
      ['ROAD','Cars travel on it'],
      ['SALT','Pepper’s partner'],
      ['SHIP','It sails'],
      ['ASAP','At once (abbr.)'],
      ['EARTH','Heart (anag.)'],
      ['OCEAN','Canoe (anag.)'],
      ['ANGEL','Glean (anag.)'],
      ['PLATE','Petal (anag.)'],
      ['STONE','Notes (anag.)'],
      ['BREAD','Beard (anag.)'],
      ['HORSE','Shore (anag.)'],
      ['LEMON','Melon (anag.)'],
      ['NIGHT','Thing (anag.)'],
      ['CHEAP','Peach (anag.)'],
      ['TIRED','Tried (anag.)'],
      ['APPLE','Fruit that keeps the doctor away'],
      ['CHAIR','You sit on it'],
      ['GREEN','Colour of grass'],
      ['HOUSE','Where you live'],
      ['MUSIC','Songs and melodies'],
      ['PAPER','You write on it'],
      ['RIVER','Water flowing to the sea'],
      ['SMILE','Happy expression'],
      ['TABLE','Furniture with a flat top'],
      ['WATER','You drink it'],
      ['CLOUD','It floats in the sky'],
      ['TIGER','Big striped cat'],
      ['TRAIN','It runs on rails'],
      ['BEACH','Sand by the sea'],
    ],
    medium: [
      ['ORE','Rock bearing metal'],
      ['ERA','Distinct period'],
      ['AIM','Intend, or target'],
      ['ODE','Poem of praise'],
      ['EBB','Tide going out'],
      ['RIM','Edge of a cup'],
      ['GMT','Greenwich time (abbr.)'],
      ['MPH','Speed measure (abbr.)'],
      ['CEO','Company boss (abbr.)'],
      ['GPS','Satellite navigation (abbr.)'],
      ['FAQ','Common questions (abbr.)'],
      ['RSVP','Please reply (abbr.)'],
      ['NASA','US space agency (abbr.)'],
      ['ACHE','Dull pain'],
      ['IDLE','Doing nothing'],
      ['OMEN','Sign of things to come'],
      ['VEIN','Blood carrier'],
      ['WEAR','Have on, or erode'],
      ['DANGER','Garden (anag.)'],
      ['MASTER','Stream (anag.)'],
      ['RESCUE','Secure (anag.)'],
      ['SILENT','Listen (anag.)'],
      ['ELBOW','Below (anag.)'],
      ['SPRAY','Prays (anag.)'],
      ['WOLVES','Vowels (anag.)'],
      ['ANCHOR','It keeps a ship in place'],
      ['BRIDGE','It carries a road over water'],
      ['CANDLE','Wax light source'],
      ['DESERT','Very dry region'],
      ['ENGINE','It powers a machine'],
      ['FOREST','Dense growth of trees'],
      ['GARDEN','Cultivated plot'],
      ['ISLAND','Land surrounded by water'],
      ['MARKET','Where goods are traded'],
      ['NEEDLE','It threads and sews'],
      ['RIBBON','Decorative strip of fabric'],
      ['WINDOW','You see through it'],
      ['MIRROR','It shows your reflection'],
      ['SEASON','Spring, for one'],
      ['TUNNEL','Passage bored through rock'],
      ['WINTER','Coldest season'],
      ['CASTLE','Fortified noble home'],
      ['KITCHEN','Room for cooking'],
      ['LANTERN','Portable light in a case'],
      ['THUNDER','It follows lightning'],
      ['VILLAGE','Settlement smaller than a town'],
      ['SECTION','Notices (anag.)'],
      ['TEACHER','Cheater (anag.)'],
      ['ADMIRER','Married (anag.)'],
    ],
    hard: [
      ['AWE','Reverent wonder'],
      ['EON','Immeasurably long time'],
      ['APT','Fitting, suitable'],
      ['WRY','Drily humorous'],
      ['CPU','Computer’s brain (abbr.)'],
      ['USB','Computer port (abbr.)'],
      ['PDF','Document format (abbr.)'],
      ['BBC','British broadcaster (abbr.)'],
      ['UNESCO','UN culture body (abbr.)'],
      ['ETA','Expected arrival (abbr.)'],
      ['EDIT','Revise a text'],
      ['ARID','Parched'],
      ['CEDE','Give up formally'],
      ['ONUS','Burden of responsibility'],
      ['SAGE','Wise one, or a herb'],
      ['TERSE','Brief to the point of rudeness'],
      ['CANDID','Frankly honest'],
      ['ORNATE','Elaborately decorated'],
      ['SUBTLE','Delicately fine'],
      ['CREATIVE','Reactive (anag.)'],
      ['TRIANGLE','Relating (anag.)'],
      ['REGENT','N greet (anag.)'],
      ['MARINE','Remain (anag.)'],
      ['DETAILS','Dilates (anag.)'],
      ['RECITAL','Article (anag.)'],
      ['ECLIPSE','One body hides another'],
      ['GRAVITY','It keeps your feet down, or a serious mood'],
      ['HORIZON','Where earth appears to meet sky'],
      ['MOMENTUM','Mass times velocity'],
      ['PARADOX','Statement that contradicts itself'],
      ['QUANDARY','State of perplexity'],
      ['SOLITUDE','Being alone, agreeably'],
      ['VIGILANT','Keeping careful watch'],
      ['ZENITH','Highest point reached'],
      ['ALCHEMY','Medieval forerunner of chemistry'],
      ['CRESCENT','Shape of a young moon'],
      ['ELOQUENT','Fluent and persuasive'],
      ['HARMONY','Agreeable combination of parts'],
      ['MERIDIAN','Line of longitude'],
      ['PENDULUM','It swings to keep time'],
      ['SANCTUARY','Place of refuge'],
      ['TRANQUIL','Calm and untroubled'],
      ['VELOCITY','Speed in a given direction'],
      ['WHISPER','Speak very softly'],
      ['EMBER','Glowing remnant of a fire'],
      ['LUMINOUS','Giving off light'],
      ['PRISTINE','Unspoilt'],
      ['SERENITY','Untroubled calm'],
      ['CATALYST','It speeds a reaction without being consumed'],
      ['FORTITUDE','Courage under pain'],
      ['NOSTALGIA','Wistful longing for the past'],
      ['LABYRINTH','Maze of winding passages'],
    ],
  };

  /* Size and difficulty are separate choices: size sets the geometry, difficulty
     picks which word bank the clues come from.
       n     = grid is n x n
       words = entries to reach for (aspirational; rarely do they all fit)
       good  = stop early once a layout reaches this many, so generating a puzzle
               never visibly freezes the app */
  /* Short fill, shared by every difficulty. Newspaper grids lean on 3 and 4 letter
     words for exactly this reason: they're what let long answers interlock. Without
     a deep pool here the grids come out sparse, and a sparse grid can't be solved
     from its crossings. */
  const CROSS_SHORT = [
    ['ACE','Top card'],['AGE','Years lived'],['AID','Help'],['ALE','Pub drink'],
    ['APE','Gorilla, for one'],['ARC','Curved path'],['ART','Gallery contents'],
    ['ASH','Fire remains'],['AXE','Chopping tool'],['BAY','Coastal inlet'],
    ['BED','You sleep in it'],['BEE','Honey maker'],['BIN','Rubbish container'],
    ['BOW','Archer’s weapon'],['BUD','Unopened flower'],['CAP','Head cover'],
    ['COD','White fish'],['COT','Baby’s bed'],['CUP','You drink from it'],
    ['DEN','Animal’s lair'],['DEW','Morning moisture'],['DIG','Excavate'],
    ['DOT','Small point'],['DUE','Owed'],['DYE','Colouring agent'],
    ['ELM','Tall tree'],['END','Final part'],['EVE','Night before'],
    ['FAN','It cools you'],['FEW','Not many'],['FIG','Soft fruit'],
    ['FIN','Fish’s limb'],['FOG','Thick mist'],['GAP','Opening'],
    ['GEM','Precious stone'],['HEN','Farm bird'],['HUE','Shade of colour'],
    ['ICY','Very cold'],['IRE','Anger'],['JAR','Glass container'],
    ['JET','Fast plane'],['KEY','It opens a lock'],['LAP','Circuit of a track'],
    ['LAW','Rule of the land'],['LID','Container top'],['LOG','Fallen timber'],
    ['MAP','It shows the way'],['NET','Fishing mesh'],['NUT','Bolt’s partner'],
    ['OAR','Rowing blade'],['OIL','Engine lubricant'],['ORB','Sphere'],
    ['OWE','Be in debt'],['PAN','Cooking vessel'],['PEA','Small green vegetable'],
    ['PEN','Writing tool'],['PIT','Deep hole'],['POT','Plant container'],
    ['RAT','Long-tailed rodent'],['RAW','Uncooked'],['RED','Colour of blood'],
    ['RIB','Chest bone'],['ROW','Line, or an argument'],['RUG','Floor covering'],
    ['SAW','Cutting tool'],['SKY','It is above you'],['SUM','Total'],
    ['TAN','Sun colour'],['TIN','Metal can'],['TIP','Advice, or a point'],
    ['TOE','Foot digit'],['TOP','Highest part'],['URN','Large vase'],
    ['VAN','Delivery vehicle'],['WAX','Candle material'],['WEB','Spider’s trap'],
    ['ACID','Sour substance'],['AREA','Region'],['BARN','Farm building'],
    ['CAVE','Hollow in rock'],['CLAY','Potter’s material'],['COIN','Metal money'],
    ['DUSK','Twilight'],['ECHO','Reflected sound'],['FERN','Shade plant'],
    ['GATE','Garden entrance'],['HERB','Kitchen plant'],['IRIS','Eye part, or a flower'],
    ['ISLE','Small island'],['KITE','It flies on a string'],['LEAF','It falls in autumn'],
    ['MOSS','Damp green growth'],['NOTE','Brief message'],['OPEN','Not shut'],
    ['PATH','Walking route'],['PINE','Evergreen tree'],['RAFT','Simple float'],
    ['REED','Marsh grass'],['ROOT','Underground part'],['SAND','Beach material'],
    ['SEED','Plant’s start'],['SILK','Smooth fabric'],['TIDE','Sea’s rise and fall'],
    ['VASE','Flower holder'],['WAVE','Sea swell, or a greeting'],['WELL','Water source'],
  ];

  const CROSS_SIZES = {
    small:  { n: 5, label: '5×5', words: 8,  good: 6  },
    medium: { n: 7, label: '7×7', words: 13, good: 10 },
    large:  { n: 9, label: '9×9', words: 20, good: 15 },
  };

  const CROSS_SETTINGS = { tries: 400, deadlineMs: 420 };

  // Fold the shared short fill into every bank, skipping anything already there.
  for(const level in CROSS_BANK){
    const have = {};
    for(const e of CROSS_BANK[level]) have[e[0]] = 1;
    for(const e of CROSS_SHORT) if(!have[e[0]]) CROSS_BANK[level].push(e);
  }

