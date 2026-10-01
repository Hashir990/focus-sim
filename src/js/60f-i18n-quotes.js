  /* ---------------- the words: quote packs ----------------

     The twelve collections in 14a-quote-packs.js, the shop pane that sells
     them, and the two levels of switch in the quote bank.

     **The quotes themselves are not here and never will be.** They are other
     people's words — Seneca's, Ada Lovelace's, a film's — and a translated
     quote is a different quote. The lists are marked `translate="no"` and stay
     in English in every language; what is translated is the app talking *about*
     them: what a pack is called, what is in it, and whether it is switched on.

     Pack names follow what each language actually calls the thing rather than a
     dictionary rendering: 漫威 and マーベル are Marvel's own names in Chinese and
     Japanese, ストア派 and 斯多葛 are the standing terms for the Stoics, and the
     borrowed forms — سنیما, फ़िल्में — are the ones people say aloud. */

  i18nAdd({
    /* ---- the shop pane ---- */
    'Quotes': {ja:'名言', zh:'语录', ru:'Цитаты', hi:'उद्धरण', ur:'اقوال', ar:'اقتباسات'},
    'as many as you like, at once': {ja:'いくつでも同時に', zh:'想开几个就开几个', ru:'сколько угодно сразу', hi:'एक साथ जितने चाहें', ur:'ایک ساتھ جتنے چاہیں', ar:'كما تشاء، في وقت واحد'},
    'showing': {ja:'表示中', zh:'显示中', ru:'показывается', hi:'दिख रहा है', ur:'دکھایا جا رہا ہے', ar:'قيد العرض'},
    'Turn single lines off in the quote bank.': {ja:'個々の言葉は名言集でオフにできます。', zh:'单条语录可以在语录库里关掉。', ru:'Отдельные строки отключаются в цитатах.', hi:'अलग-अलग पंक्तियाँ सुविचार संग्रह में बंद करें।', ur:'انفرادی سطریں اقوال کے ذخیرے میں بند کریں۔', ar:'يمكن إيقاف العبارات فرادى من مكتبة الاقتباسات.'},
    /* Keyed on the plural, because `Tn` looks up the *many* form and picks the
       right shape out of it — filed under '{n} quote' it is simply never
       found, and the tile reads "10 quotes" in the middle of a translated
       line. The same mistake cost "embers unspent" a release. */
    '{n} quotes': {ja:'{n}件', zh:'{n} 条', ru:{one:'{n} цитата', few:'{n} цитаты', many:'{n} цитат', other:'{n} цитаты'}, hi:'{n} उद्धरण', ur:'{n} اقوال',
      ar:{zero:'لا اقتباسات', one:'اقتباس واحد', two:'اقتباسان', few:'{n} اقتباسات', many:'{n} اقتباسًا', other:'{n} اقتباس'}},

    /* ---- the two switches in the quote bank ---- */
    'Packs': {ja:'パック', zh:'语录包', ru:'Наборы', hi:'पैक', ur:'پیک', ar:'الحزم'},
    'On': {ja:'オン', zh:'开', ru:'Вкл.', hi:'चालू', ur:'آن', ar:'تشغيل'},
    /* The twenty the app ships with, listed in the bank beside the bought packs
       so that turning a line off is the same action wherever it came from. */
    'Built in': {ja:'標準の名言', zh:'内置', ru:'Встроенные', hi:'बिल्ट-इन', ur:'بلٹ اِن', ar:'المدمجة'},
    'The twenty the app came with': {ja:'アプリに最初から入っている20件', zh:'应用自带的二十条', ru:'Двадцать, что были в приложении с самого начала', hi:'ऐप के साथ आए बीस', ur:'ایپ کے ساتھ آئے بیس', ar:'العشرون التي جاءت مع التطبيق'},
    'Quote packs are in the shop, under Your focus.': {ja:'名言パックはショップ（集中の記録）にあります。', zh:'语录包在商店里，位于「我的专注」。', ru:'Наборы цитат, в магазине, в разделе «Ваш фокус».', hi:'क्वोट पैक शॉप में हैं, "आपका फ़ोकस" के अंदर।', ur:'کوٹ پیک دکان میں ہیں، "آپ کا فوکس" کے اندر۔', ar:'حزم الاقتباسات في المتجر، ضمن "تركيزك".'},

    /* ---- what the twelve are called ---- */
    'Stoics': {ja:'ストア派', zh:'斯多葛', ru:'Стоики', hi:'स्टोइक', ur:'رواقی', ar:'الرواقيون'},
    'Marcus Aurelius, Seneca, Epictetus': {ja:'マルクス・アウレリウス、セネカ、エピクテトス', zh:'马可·奥勒留、塞内卡、爱比克泰德', ru:'Марк Аврелий, Сенека, Эпиктет', hi:'मार्कस ऑरेलियस, सेनेका, एपिक्टेटस', ur:'مارکس اوریلیس، سینیکا، ایپکٹیٹس', ar:'ماركوس أوريليوس وسينيكا وإبكتيتوس'},
    'Philosophy': {ja:'哲学', zh:'哲学', ru:'Философия', hi:'दर्शन', ur:'فلسفہ', ar:'الفلسفة'},
    'Questions that outlived the people who asked them': {ja:'問うた人より長く生きた問い', zh:'比提问者活得更久的问题', ru:'Вопросы, пережившие тех, кто их задал', hi:'सवाल, जो पूछने वालों से ज़्यादा जिए', ur:'سوال جو پوچھنے والوں سے زیادہ جیے', ar:'أسئلة عُمِّرت بعد من طرحوها'},
    'Scientists': {ja:'科学者', zh:'科学家', ru:'Учёные', hi:'वैज्ञानिक', ur:'سائنسدان', ar:'العلماء'},
    'People who asked why for a living': {ja:'「なぜ」を仕事にした人たち', zh:'以追问为业的人', ru:'Те, для кого «почему» было работой', hi:'जिनका काम ही "क्यों" पूछना था', ur:'جن کا کام ہی "کیوں" پوچھنا تھا', ar:'من جعلوا السؤال مهنة'},
    'Writers': {ja:'作家', zh:'作家', ru:'Писатели', hi:'लेखक', ur:'لکھاری', ar:'الكُتّاب'},
    'Novelists, on getting the words down': {ja:'書きとめることについて、小説家たち', zh:'小说家谈如何把字写下来', ru:'Романисты о том, как ложатся слова', hi:'उपन्यासकार, शब्द उतारने पर', ur:'ناول نگار، لفظ اتارنے پر', ar:'روائيون عن تدوين الكلمات'},
    'Poets': {ja:'詩人', zh:'诗人', ru:'Поэты', hi:'कवि', ur:'شاعر', ar:'الشعراء'},
    'Lines that were made to be said aloud': {ja:'声に出すための一行', zh:'为朗读而写的句子', ru:'Строки, написанные вслух', hi:'पंक्तियाँ, जो बोलने के लिए बनी हैं', ur:'سطریں جو بول کر پڑھنے کو بنی ہیں', ar:'أبيات كُتبت لتُقال بصوت'},
    'Sport': {ja:'スポーツ', zh:'体育', ru:'Спорт', hi:'खेल', ur:'کھیل', ar:'الرياضة'},
    'Years of training, judged in seconds': {ja:'何年もの練習が、数秒で決まる', zh:'多年苦练，几秒定论', ru:'Годы тренировок, решённые за секунды', hi:'बरसों की मेहनत, सेकंडों में फ़ैसला', ur:'برسوں کی محنت، سیکنڈوں میں فیصلہ', ar:'سنوات تدريب يحكم عليها في ثوانٍ'},
    'Builders': {ja:'つくる人', zh:'创造者', ru:'Создатели', hi:'बनाने वाले', ur:'بنانے والے', ar:'الصُنّاع'},
    'Founders, engineers and makers of things': {ja:'創業者、技術者、ものをつくる人', zh:'创始人、工程师和做东西的人', ru:'Основатели, инженеры и те, кто делает вещи', hi:'संस्थापक, इंजीनियर और चीज़ें बनाने वाले', ur:'بانی، انجینئر اور چیزیں بنانے والے', ar:'مؤسسون ومهندسون وصانعو أشياء'},
    'Programmers': {ja:'プログラマー', zh:'程序员', ru:'Программисты', hi:'प्रोग्रामर', ur:'پروگرامر', ar:'المبرمجون'},
    'Rules from people who ship': {ja:'出荷してきた人たちの原則', zh:'来自真正交付过的人', ru:'Правила от тех, кто доводит до релиза', hi:'उनके नियम जो सचमुच शिप करते हैं', ur:'اُن کے اصول جو واقعی شپ کرتے ہیں', ar:'قواعد ممن يُطلقون فعلًا'},
    'Explorers': {ja:'探検家', zh:'探险家', ru:'Исследователи', hi:'खोजी', ur:'مہم جو', ar:'المستكشفون'},
    'Ice, ocean and orbit': {ja:'氷と、海と、軌道', zh:'冰原、海洋与轨道', ru:'Лёд, океан и орбита', hi:'बर्फ़, समुद्र और कक्षा', ur:'برف، سمندر اور مدار', ar:'الجليد والمحيط والمدار'},
    'Cinema': {ja:'映画', zh:'电影', ru:'Кино', hi:'सिनेमा', ur:'سنیما', ar:'السينما'},
    'Lines the whole room knew by heart': {ja:'客席みんなが覚えていた台詞', zh:'全场都会背的台词', ru:'Реплики, которые знал наизусть весь зал', hi:'वो संवाद जो पूरा हॉल जानता था', ur:'وہ مکالمے جو پورا ہال جانتا تھا', ar:'جُمل حفظتها القاعة كلها'},
    /* Marvel's own name in each market, not a translation of the word. */
    'Marvel': {ja:'マーベル', zh:'漫威', ru:'Marvel', hi:'मार्वल', ur:'مارول', ar:'مارفل'},
    'What the heroes said': {ja:'ヒーローたちの言葉', zh:'英雄们说过的话', ru:'Что говорили герои', hi:'हीरोज़ ने जो कहा', ur:'ہیروز نے جو کہا', ar:'ما قاله الأبطال'},
    'Music': {ja:'音楽', zh:'音乐', ru:'Музыка', hi:'संगीत', ur:'موسیقی', ar:'الموسيقى'},
    'Musicians on their craft': {ja:'音楽家が語る、その仕事', zh:'音乐家谈自己的手艺', ru:'Музыканты о своём ремесле', hi:'संगीतकार अपने हुनर पर', ur:'موسیقار اپنے فن پر', ar:'موسيقيون عن حرفتهم'},
  });
