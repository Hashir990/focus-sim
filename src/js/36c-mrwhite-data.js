  /* ---------------- MR WHITE: the prompts ----------------

     Seven sets, a hundred and more in each. The room votes on a set before the
     game starts and one word is drawn from the winner.

     **What makes a word work here.** Everybody but Mr White is shown it, and
     has to say something that proves they know it without naming it. So a word
     has to be *specific enough to hint at* and *common enough that everybody
     pictures the same thing*. "Bread" is a good word: warm, bakery, toast,
     butter. "Thing" is not, and neither is anything so rare that half the room
     would have to bluff — which is the game Mr White is playing, and it stops
     being interesting when everybody is doing it.

     They are single words and lower case, so a hint is never just the word with
     a capital letter, and so nothing on the screen looks like a title.

     **English, like the other word games.** The crossword, Scrabble, hangman and
     pictionary are all English and the arcade says so on their cards; this one
     says it too. A translated prompt list is a different game in each language
     and would need a different Mr White to go with it.

     Stored as one string per set and split at run time: six hundred quoted
     strings is six hundred chances for a stray quote, and this way a set is a
     paragraph you can read. */

  const MW_SETS = [
    {id:'food', name:'Food', note:'Things to eat and drink', words:(
      'apple, avocado, bacon, bagel, banana, basil, beans, beef, beer, biscuit, '
      + 'blueberry, bread, broccoli, brownie, burger, butter, cabbage, cake, '
      + 'candy, carrot, cashew, cereal, cheese, cherry, chicken, chilli, '
      + 'chocolate, cinnamon, coconut, coffee, cookie, corn, crab, cream, '
      + 'croissant, cucumber, cupcake, curry, custard, doughnut, dumpling, egg, '
      + 'falafel, fig, fish, flour, fries, garlic, ginger, grape, gravy, honey, '
      + 'hummus, ice cream, jam, jelly, ketchup, kebab, kiwi, lamb, lasagne, '
      + 'lemon, lentil, lettuce, lime, lobster, mango, maple syrup, mayonnaise, '
      + 'melon, milk, mint, muffin, mushroom, mustard, noodles, nutmeg, oats, '
      + 'olive, omelette, onion, orange, oyster, pancake, papaya, pasta, peach, '
      + 'peanut, pear, peas, pepper, pickle, pie, pineapple, pizza, plum, '
      + 'popcorn, porridge, potato, prawn, pudding, pumpkin, radish, raisin, '
      + 'rice, salad, salmon, salt, sandwich, sausage, soup, spinach, steak, '
      + 'strawberry, sugar, sushi, taco, tea, toast, tomato, tuna, vanilla, '
      + 'waffle, walnut, watermelon, yoghurt'
    )},
    {id:'animals', name:'Animals', note:'Everything that moves on its own', words:(
      'alligator, alpaca, ant, antelope, badger, bat, bear, beaver, bee, beetle, '
      + 'bison, blackbird, buffalo, bull, butterfly, camel, cat, caterpillar, '
      + 'chameleon, cheetah, chicken, chimpanzee, clam, cobra, cockroach, cod, '
      + 'cow, coyote, crab, crane, cricket, crocodile, crow, deer, dog, dolphin, '
      + 'donkey, dove, dragonfly, duck, eagle, eel, elephant, falcon, ferret, '
      + 'finch, flamingo, fly, fox, frog, gazelle, gecko, giraffe, goat, goose, '
      + 'gorilla, grasshopper, hamster, hare, hawk, hedgehog, heron, hippo, '
      + 'horse, hummingbird, hyena, jaguar, jellyfish, kangaroo, kingfisher, '
      + 'koala, ladybird, lemur, leopard, lion, lizard, llama, lobster, magpie, '
      + 'mantis, mole, mongoose, monkey, moose, mosquito, moth, mouse, mule, '
      + 'newt, octopus, orca, ostrich, otter, owl, ox, panda, panther, parrot, '
      + 'peacock, pelican, penguin, pig, pigeon, porcupine, puffin, python, '
      + 'rabbit, raccoon, ram, rat, raven, reindeer, rhino, salmon, scorpion, '
      + 'seagull, seahorse, seal, shark, sheep, shrimp, skunk, sloth, snail, '
      + 'snake, sparrow, spider, squid, squirrel, stork, swan, tiger, toad, '
      + 'tortoise, toucan, turkey, turtle, walrus, wasp, weasel, whale, wolf, '
      + 'wombat, woodpecker, worm, yak, zebra'
    )},
    {id:'people', name:'People', note:'Names most of the room will know', words:(
      'Aristotle, Beethoven, Beyoncé, Bill Gates, Bob Marley, Buzz Aldrin, '
      + 'Charles Darwin, Charlie Chaplin, Cleopatra, Confucius, David Attenborough, '
      + 'Elvis Presley, Frida Kahlo, Galileo, Gandhi, Genghis Khan, Harry Potter, '
      + 'Isaac Newton, James Bond, Jane Austen, Julius Caesar, Leonardo da Vinci, '
      + 'Lionel Messi, Louis Pasteur, Malala, Marco Polo, Marie Curie, '
      + 'Mark Twain, Michael Jackson, Michael Jordan, Michelangelo, Mickey Mouse, '
      + 'Mozart, Muhammad Ali, Napoleon, Neil Armstrong, Nikola Tesla, '
      + 'Pablo Picasso, Pelé, Plato, Roald Dahl, Rumi, Serena Williams, '
      + 'Shakespeare, Sherlock Holmes, Socrates, Stephen Hawking, Steve Jobs, '
      + 'Superman, Taylor Swift, Tolkien, Usain Bolt, Walt Disney, '
      + 'Alexander the Great, Amelia Earhart, Anne Frank, Archimedes, '
      + 'Batman, Bruce Lee, Captain Cook, Chopin, Christopher Columbus, '
      + 'Cristiano Ronaldo, Diego Maradona, Edison, Einstein, Emily Dickinson, '
      + 'Florence Nightingale, Ford, Franklin, Freddie Mercury, Homer, '
      + 'Ibn Battuta, Joan of Arc, John Lennon, Keanu Reeves, King Arthur, '
      + 'Leonardo DiCaprio, Lewis Hamilton, Lincoln, Marilyn Monroe, '
      + 'Martin Luther King, Mary Shelley, Maya Angelou, Mona Lisa, Mother Teresa, '
      + 'Nelson Mandela, Oprah, Peter Pan, Robin Hood, Roger Federer, '
      + 'Rosa Parks, Santa Claus, Spider-Man, Tarzan, Tchaikovsky, '
      + 'Tutankhamun, Vincent van Gogh, Wright brothers, Yuri Gagarin'
    )},
    {id:'jobs', name:'Jobs', note:'What people do all day', words:(
      'accountant, actor, architect, astronaut, athlete, author, baker, banker, '
      + 'barber, barista, bartender, blacksmith, builder, butcher, captain, '
      + 'carpenter, cashier, chef, chemist, cleaner, coach, composer, conductor, '
      + 'consultant, cook, courier, dancer, dentist, designer, detective, '
      + 'diplomat, diver, doctor, driver, editor, electrician, engineer, farmer, '
      + 'firefighter, fisherman, florist, gardener, geologist, goalkeeper, '
      + 'guard, guide, hairdresser, historian, illustrator, inventor, janitor, '
      + 'jeweller, journalist, judge, lawyer, lecturer, librarian, lifeguard, '
      + 'locksmith, magician, mechanic, midwife, miner, model, musician, nanny, '
      + 'nurse, optician, painter, paramedic, pharmacist, photographer, pilot, '
      + 'plumber, poet, police officer, porter, postman, potter, presenter, '
      + 'priest, professor, programmer, psychologist, receptionist, referee, '
      + 'reporter, sailor, salesman, scientist, sculptor, secretary, security '
      + 'guard, shepherd, singer, soldier, surgeon, tailor, teacher, therapist, '
      + 'translator, vet, waiter, watchmaker, welder, writer'
    )},
    {id:'house', name:'Household', note:'Things around the house', words:(
      'alarm clock, apron, armchair, ashtray, bin, blanket, blender, bookshelf, '
      + 'bottle, bowl, broom, brush, bucket, candle, carpet, ceiling fan, chair, '
      + 'chest of drawers, clock, coat hanger, comb, cooker, corkscrew, cot, '
      + 'couch, cupboard, curtain, cushion, cutlery, desk, dishwasher, doorbell, '
      + 'doormat, drawer, dustpan, duvet, fan, fireplace, flask, fork, freezer, '
      + 'fridge, frying pan, glass, hairdryer, hammer, hanger, heater, hoover, '
      + 'iron, ironing board, jug, kettle, key, knife, ladder, lamp, laundry '
      + 'basket, letterbox, lightbulb, mattress, microwave, mirror, mop, mug, '
      + 'nail, napkin, oven, pillow, plant pot, plate, plug, radiator, remote '
      + 'control, rug, saucepan, scissors, screwdriver, shelf, shoe rack, '
      + 'shower, sink, soap, sofa, spatula, sponge, spoon, stairs, stool, '
      + 'stove, table, tap, teapot, telephone, television, thermometer, '
      + 'toaster, toilet, toothbrush, towel, tray, umbrella, vacuum cleaner, '
      + 'vase, wardrobe, washing machine, wastebasket, watch, window, wok'
    )},
    {id:'actions', name:'Actions', note:'Things you can do', words:(
      'applaud, apologise, argue, bake, balance, bargain, bathe, bend, blink, '
      + 'blush, boast, borrow, bounce, bow, breathe, build, carry, celebrate, '
      + 'chase, chew, climb, collect, complain, cook, copy, crawl, cry, cycle, '
      + 'dance, daydream, deliver, dig, dive, draw, dream, drive, drop, eat, '
      + 'escape, exercise, explain, fall, fight, fish, float, fly, fold, '
      + 'forgive, gamble, gossip, greet, grow, hide, hug, hum, hunt, hurry, '
      + 'ignore, interrupt, invite, iron, joke, juggle, jump, kick, kneel, '
      + 'knit, knock, laugh, lean, learn, lie down, lift, listen, march, melt, '
      + 'mumble, nap, nod, paint, panic, park, photograph, point, pour, pray, '
      + 'promise, pull, push, queue, read, recycle, remember, rescue, rest, '
      + 'ride, run, sail, salute, save, scream, search, sew, shave, shiver, '
      + 'shop, shout, shrug, sing, sketch, skip, sleep, smile, sneeze, snore, '
      + 'spill, stretch, stumble, swim, teach, thank, throw, tickle, tiptoe, '
      + 'travel, unpack, vote, wait, wake, walk, wash, wave, whisper, whistle, '
      + 'wink, wrap, write, yawn'
    )},
    /* **Countries, and only ones a room will have heard of.**

       The rule for every other set is that a word has to be common enough that
       everybody pictures the same thing, and it bites hardest here: there are
       a hundred and ninety-odd countries and most rooms could not place half
       of them, so a list of all of them is a list where Mr White is safe most
       of the time because nobody else has anything to say either.

       So this is the ones with something to hint at — a flag, a food, a team,
       a building, a piece of history. Written the way they are said rather
       than the way a passport says them, because "the Netherlands" is what
       somebody will call it out loud. Capitalised, like the people, because
       that is how the words are spelt and a hint is a sentence about the place
       rather than the name with a small letter. */
    {id:'countries', name:'Countries', note:'Places most of the room could place', words:(
      'Afghanistan, Albania, Algeria, Argentina, Australia, Austria, '
      + 'Bangladesh, Belgium, Bolivia, Bosnia, Brazil, Bulgaria, Cambodia, '
      + 'Cameroon, Canada, Chile, China, Colombia, Costa Rica, Croatia, Cuba, '
      + 'Cyprus, Czechia, Denmark, Ecuador, Egypt, El Salvador, Estonia, '
      + 'Ethiopia, Fiji, Finland, France, Georgia, Germany, Ghana, Greece, '
      + 'Guatemala, Haiti, Honduras, Hungary, Iceland, India, Indonesia, Iran, '
      + 'Iraq, Ireland, Israel, Italy, Jamaica, Japan, Jordan, Kazakhstan, '
      + 'Kenya, Kuwait, Laos, Latvia, Lebanon, Libya, Lithuania, Luxembourg, '
      + 'Madagascar, Malaysia, Maldives, Mali, Malta, Mexico, Mongolia, '
      + 'Morocco, Mozambique, Myanmar, Namibia, Nepal, New Zealand, Nicaragua, '
      + 'Nigeria, North Korea, Norway, Oman, Pakistan, Palestine, Panama, '
      + 'Papua New Guinea, Paraguay, Peru, Poland, Portugal, Qatar, Romania, '
      + 'Russia, Rwanda, Saudi Arabia, Senegal, Serbia, Singapore, Slovakia, '
      + 'Slovenia, Somalia, South Africa, South Korea, Spain, Sri Lanka, '
      + 'Sudan, Sweden, Switzerland, Syria, Taiwan, Tanzania, Thailand, '
      + 'the Netherlands, the Philippines, Tunisia, Turkey, Uganda, Ukraine, '
      + 'United Arab Emirates, United Kingdom, United States, Uruguay, '
      + 'Uzbekistan, Venezuela, Vietnam, Yemen, Zambia, Zimbabwe'
    )},
  ];

  /** A set's words as a list, cut from the paragraph it is written as. */
  function mwWords(setId){
    const s = MW_SETS.find(x=>x.id === setId);
    if(!s) return [];
    return s.words.split(',').map(w=>w.trim()).filter(Boolean);
  }
