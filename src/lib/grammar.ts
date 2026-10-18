// Pista de gramática orientada a LEER (reconocer), no a producir.
// Orden curado; `unlockAt` = kanji aprendidos necesarios. Ejemplos con notación {漢字|かな}.
import type { GrammarPoint } from './types.ts';

type Def = Omit<GrammarPoint, 'level' | 'unlockAt'>;

const L1: Def[] = [
	{ id: 'wa', pattern: '〜は', meaning: 'marca el tema («en cuanto a…»)', explanation: 'Se escribe は pero se lee «wa». Indica de qué se habla; lo importante viene después.', examples: [{ jp: '{私|わたし}は{学生|がくせい}です。', es: 'Yo soy estudiante.' }] },
	{ id: 'ga', pattern: '〜が', meaning: 'marca el sujeto (información nueva)', explanation: 'Señala quién hace o qué es algo, a menudo como dato nuevo o enfático.', examples: [{ jp: '{雨|あめ}が{降|ふ}っている。', es: 'Está lloviendo (cae lluvia).' }] },
	{ id: 'wo', pattern: '〜を', meaning: 'marca el objeto directo', explanation: 'Se lee «o». Lo que recibe la acción del verbo.', examples: [{ jp: '{本|ほん}を{読|よ}む。', es: 'Leo un libro.' }] },
	{ id: 'ni', pattern: '〜に', meaning: 'destino, momento o receptor', explanation: 'Hacia dónde, cuándo (hora/día) o a quién.', examples: [{ jp: '{七時|しちじ}に{学校|がっこう}に{行|い}く。', es: 'Voy a la escuela a las siete.' }] },
	{ id: 'de', pattern: '〜で', meaning: 'lugar de la acción o medio', explanation: 'Dónde ocurre algo o con qué se hace.', examples: [{ jp: '{電車|でんしゃ}で{行|い}く。', es: 'Voy en tren.' }] },
	{ id: 'no', pattern: '〜の', meaning: 'posesión o relación («de»)', explanation: 'Une dos sustantivos: el primero modifica al segundo.', examples: [{ jp: '{友達|ともだち}の{車|くるま}', es: 'el coche de mi amigo' }] },
	{ id: 'mo', pattern: '〜も', meaning: '«también / tampoco»', explanation: 'Sustituye a は/が/を y añade «también»; con negativo, «tampoco».', examples: [{ jp: '{私|わたし}も{行|い}く。', es: 'Yo también voy.' }] },
	{ id: 'to', pattern: '〜と', meaning: '«y» (lista cerrada) / «con»', explanation: 'Une sustantivos de forma exhaustiva o indica compañía.', examples: [{ jp: '{猫|ねこ}と{犬|いぬ}', es: 'un gato y un perro' }] },
	{ id: 'kara-made', pattern: '〜から〜まで', meaning: '«desde… hasta…»', explanation: 'Punto de inicio y de final, en el espacio o el tiempo.', examples: [{ jp: '{朝|あさ}から{夜|よる}まで', es: 'desde la mañana hasta la noche' }] },
	{ id: 'desu-da', pattern: '〜です / 〜だ', meaning: '«ser / estar» (cortés / llano)', explanation: 'です es la forma cortés; だ la llana, típica de manga y novela.', examples: [{ jp: 'これは{本|ほん}だ。', es: 'Esto es un libro.' }] },
	{ id: 'ka', pattern: '〜か', meaning: 'convierte la frase en pregunta', explanation: 'Al final de la frase marca interrogación (en habla casual a veces se omite).', examples: [{ jp: '{日本人|にほんじん}ですか。', es: '¿Es usted japonés?' }] },
	{ id: 'ne-yo', pattern: '〜ね / 〜よ', meaning: '«¿verdad?» / «¡te digo!»', explanation: 'ね busca acuerdo; よ aporta información o énfasis.', examples: [{ jp: 'いい{天気|てんき}だね。', es: 'Hace buen tiempo, ¿eh?' }] },
	{ id: 'masu', pattern: '〜ます', meaning: 'verbo en forma cortés', explanation: 'Forma educada del verbo; ません es su negativo.', examples: [{ jp: '{毎日|まいにち}{勉強|べんきょう}します。', es: 'Estudio todos los días.' }] },
	{ id: 'nai', pattern: '〜ない', meaning: 'negación (forma llana)', explanation: 'Forma negativa informal del verbo: {行|い}かない «no voy».', examples: [{ jp: '{肉|にく}を{食|た}べない。', es: 'No como carne.' }] },
	{ id: 'ta', pattern: '〜た', meaning: 'pasado (forma llana)', explanation: 'Acción terminada. Negativo pasado: 〜なかった.', examples: [{ jp: '{昨日|きのう}{映画|えいが}を{見|み}た。', es: 'Ayer vi una película.' }] },
	{ id: 'adj-i', pattern: '〜い / 〜くない / 〜かった', meaning: 'adjetivo -i: negativo y pasado', explanation: 'Los adjetivos en い se conjugan: {高|たか}い → {高|たか}くない (no es caro) → {高|たか}かった (era caro).', examples: [{ jp: 'この{店|みせ}は{安|やす}くない。', es: 'Esta tienda no es barata.' }] }
];

const L2: Def[] = [
	{ id: 'te', pattern: '〜て', meaning: 'encadena acciones («y luego»)', explanation: 'La forma て une verbos en secuencia o causa leve.', examples: [{ jp: '{起|お}きて、{顔|かお}を{洗|あら}う。', es: 'Me levanto y me lavo la cara.' }] },
	{ id: 'te-iru', pattern: '〜ている', meaning: 'acción en curso o estado resultante', explanation: '«Estar haciendo» o un estado que permanece ({結婚|けっこん}している = estar casado). Coloquial: 〜てる.', examples: [{ jp: '{今|いま}、{雨|あめ}が{降|ふ}っている。', es: 'Ahora está lloviendo.' }] },
	{ id: 'tai', pattern: '〜たい', meaning: '«quiero (hacer)»', explanation: 'Deseo del hablante. Se conjuga como adjetivo -i: たくない, たかった.', examples: [{ jp: '{日本|にほん}に{行|い}きたい。', es: 'Quiero ir a Japón.' }] },
	{ id: 'kudasai', pattern: '〜てください', meaning: 'petición cortés («por favor, haz…»)', explanation: 'Forma て + ください. En carteles: お〜ください.', examples: [{ jp: 'ここに{名前|なまえ}を{書|か}いてください。', es: 'Escriba su nombre aquí, por favor.' }] },
	{ id: 'mashou', pattern: '〜ましょう / 〜よう', meaning: '«hagamos…» (invitación)', explanation: 'Propuesta o voluntad. Llano: {行|い}こう «vamos».', examples: [{ jp: '{一緒|いっしょ}に{行|い}こう！', es: '¡Vamos juntos!' }] },
	{ id: 'temo-ii', pattern: '〜てもいい', meaning: 'permiso («se puede…»)', explanation: '«Está bien si…». En pregunta: 〜てもいいですか.', examples: [{ jp: '{入|はい}ってもいいですか。', es: '¿Puedo entrar?' }] },
	{ id: 'tewa-ikenai', pattern: '〜てはいけない', meaning: 'prohibición («no se debe…»)', explanation: 'Muy común en avisos. Coloquial: 〜ちゃだめ.', examples: [{ jp: 'ここで{写真|しゃしん}を{撮|と}ってはいけません。', es: 'Aquí no se pueden hacer fotos.' }] },
	{ id: 'nakereba', pattern: '〜なければならない', meaning: 'obligación («tengo que…»)', explanation: 'Coloquial: 〜なきゃ / 〜なくちゃ.', examples: [{ jp: 'もう{帰|かえ}らなきゃ。', es: 'Ya me tengo que ir a casa.' }] },
	{ id: 'ta-koto', pattern: '〜たことがある', meaning: 'experiencia («alguna vez he…»)', explanation: 'Pasado + ことがある.', examples: [{ jp: '{富士山|ふじさん}に{登|のぼ}ったことがある。', es: 'He subido al monte Fuji alguna vez.' }] },
	{ id: 'kara-node', pattern: '〜から / 〜ので', meaning: 'causa («porque…»)', explanation: 'Tras una frase, indica la razón. ので suena más suave/objetivo.', examples: [{ jp: '{疲|つか}れたから{寝|ね}る。', es: 'Me acuesto porque estoy cansado.' }] },
	{ id: 'kedo', pattern: '〜けど / 〜が', meaning: '«pero / aunque»', explanation: 'Contraste. けど es coloquial; が más formal.', examples: [{ jp: '{高|たか}いけど、{買|か}う。', es: 'Es caro, pero lo compro.' }] },
	{ id: 'yori-hou', pattern: '〜より〜のほうが', meaning: 'comparación («más que»)', explanation: 'AよりBのほうが… = B es más … que A.', examples: [{ jp: '{夏|なつ}より{冬|ふゆ}のほうが{好|す}きだ。', es: 'Me gusta más el invierno que el verano.' }] },
	{ id: 'sugiru', pattern: '〜すぎる', meaning: '«demasiado»', explanation: 'Raíz del verbo o adjetivo sin い + すぎる.', examples: [{ jp: '{食|た}べすぎた。', es: 'Comí demasiado.' }] },
	{ id: 'yasui-nikui', pattern: '〜やすい / 〜にくい', meaning: '«fácil / difícil de…»', explanation: 'Raíz del verbo + やすい o にくい.', examples: [{ jp: 'この{字|じ}は{読|よ}みにくい。', es: 'Esta letra es difícil de leer.' }] },
	{ id: 'dake-shika', pattern: '〜だけ / 〜しか〜ない', meaning: '«solo»', explanation: 'だけ es neutro; しか…ない recalca que es poco.', examples: [{ jp: '{百円|ひゃくえん}しかない。', es: 'Solo tengo cien yenes.' }] },
	{ id: 'deshou', pattern: '〜でしょう / 〜だろう', meaning: 'suposición («probablemente»)', explanation: 'Conjetura del hablante; だろう en narración y habla masculina.', examples: [{ jp: '{明日|あした}は{晴|は}れるだろう。', es: 'Mañana probablemente hará sol.' }] },
	{ id: 'kamoshirenai', pattern: '〜かもしれない', meaning: '«quizá / puede que»', explanation: 'Posibilidad menos segura que でしょう. Coloquial: かも.', examples: [{ jp: '{遅|おく}れるかもしれない。', es: 'Puede que llegue tarde.' }] },
	{ id: 'nda', pattern: '〜んだ / 〜のだ', meaning: 'explicación o énfasis', explanation: 'Da contexto o explica («es que…»). Omnipresente en manga.', examples: [{ jp: '{知|し}らなかったんだ。', es: 'Es que no lo sabía.' }] }
];

const L3: Def[] = [
	{ id: 'tara', pattern: '〜たら', meaning: '«si / cuando» (condición cumplida)', explanation: 'Pasado + ら. Muy versátil, también para descubrimientos («al…»).', examples: [{ jp: '{家|いえ}に{帰|かえ}ったら、{電話|でんわ}して。', es: 'Cuando llegues a casa, llámame.' }] },
	{ id: 'ba', pattern: '〜ば', meaning: 'condicional «si…»', explanation: 'Condición general o hipotética: {行|い}けば «si vas».', examples: [{ jp: '{安|やす}ければ{買|か}う。', es: 'Si es barato, lo compro.' }] },
	{ id: 'to-cond', pattern: '〜と (condicional)', meaning: 'consecuencia automática («al…, siempre que…»)', explanation: 'Forma de diccionario + と: resultado natural o inevitable.', examples: [{ jp: '{春|はる}になると、{花|はな}が{咲|さ}く。', es: 'Al llegar la primavera, florecen las flores.' }] },
	{ id: 'nara', pattern: '〜なら', meaning: '«si se trata de…»', explanation: 'Retoma lo dicho por el otro y da una opinión.', examples: [{ jp: '{寿司|すし}なら、あの{店|みせ}がいい。', es: 'Si es sushi, esa tienda es buena.' }] },
	{ id: 'te-shimau', pattern: '〜てしまう / 〜ちゃう', meaning: 'acción completa o sin querer', explanation: 'Acabar del todo o hacer algo lamentable. Coloquial: ちゃう/じゃう.', examples: [{ jp: '{財布|さいふ}を{忘|わす}れちゃった。', es: 'Se me olvidó la cartera.' }] },
	{ id: 'te-oku', pattern: '〜ておく', meaning: 'hacer de antemano', explanation: 'Preparar algo para después. Coloquial: 〜とく.', examples: [{ jp: '{切符|きっぷ}を{買|か}っておく。', es: 'Compro el billete de antemano.' }] },
	{ id: 'te-miru', pattern: '〜てみる', meaning: '«probar a…»', explanation: 'Hacer algo para ver qué tal.', examples: [{ jp: 'この{料理|りょうり}を{食|た}べてみて。', es: 'Prueba este plato.' }] },
	{ id: 'nagara', pattern: '〜ながら', meaning: '«mientras»', explanation: 'Dos acciones a la vez del mismo sujeto.', examples: [{ jp: '{音楽|おんがく}を{聞|き}きながら{歩|ある}く。', es: 'Camino mientras escucho música.' }] },
	{ id: 'noni', pattern: '〜のに', meaning: '«a pesar de que» (con queja)', explanation: 'Contraste con sorpresa o reproche.', examples: [{ jp: '{約束|やくそく}したのに、{来|こ}なかった。', es: 'Aunque lo prometió, no vino.' }] },
	{ id: 'you-ni', pattern: '〜ように', meaning: '«para que / de modo que»', explanation: 'Finalidad con verbos no voluntarios o potenciales.', examples: [{ jp: '{忘|わす}れないようにメモする。', es: 'Lo apunto para no olvidarlo.' }] },
	{ id: 'tame-ni', pattern: '〜ために', meaning: '«para» (finalidad) / «por» (causa)', explanation: 'Objetivo deliberado o causa formal.', examples: [{ jp: '{家族|かぞく}のために{働|はたら}く。', es: 'Trabajo por mi familia.' }] },
	{ id: 'sou-look', pattern: '〜そう (aspecto)', meaning: '«parece que…» (por lo que se ve)', explanation: 'Raíz + そう: impresión visual. {美味|おい}しそう «tiene buena pinta».', examples: [{ jp: '{雨|あめ}が{降|ふ}りそうだ。', es: 'Parece que va a llover.' }] },
	{ id: 'sou-hear', pattern: '〜そうだ (rumor)', meaning: '«dicen que…»', explanation: 'Forma llana completa + そうだ: información de oídas.', examples: [{ jp: '{明日|あした}は{雪|ゆき}だそうだ。', es: 'Dicen que mañana nevará.' }] },
	{ id: 'rashii-mitai', pattern: '〜らしい / 〜みたい', meaning: '«al parecer / como si»', explanation: 'Deducción por indicios; みたい es coloquial y también «como».', examples: [{ jp: '{彼|かれ}は{病気|びょうき}らしい。', es: 'Al parecer está enfermo.' }] },
	{ id: 'hazu', pattern: '〜はず', meaning: '«debería (lógicamente)»', explanation: 'Expectativa razonada. はずがない = es imposible que.', examples: [{ jp: 'もう{着|つ}いているはずだ。', es: 'Ya debería haber llegado.' }] },
	{ id: 'tsumori', pattern: '〜つもり', meaning: '«tener la intención de»', explanation: 'Plan del hablante.', examples: [{ jp: '{来年|らいねん}、{留学|りゅうがく}するつもりだ。', es: 'El año que viene pienso estudiar en el extranjero.' }] },
	{ id: 'kureru', pattern: '〜てくれる / 〜てもらう / 〜てあげる', meaning: 'favores: recibir / conseguir / dar', explanation: 'Quién hace el favor a quién: くれる (a mí), もらう (consigo que), あげる (yo a otro).', examples: [{ jp: '{友達|ともだち}が{手伝|てつだ}ってくれた。', es: 'Mi amigo me ayudó.' }] },
	{ id: 'potential', pattern: 'forma potencial 〜れる / 〜える', meaning: '«poder (hacer)»', explanation: '{読|よ}む → {読|よ}める, {見|み}る → {見|み}られる/{見|み}れる.', examples: [{ jp: '{漢字|かんじ}が{読|よ}める。', es: 'Puedo leer kanji.' }] },
	{ id: 'passive', pattern: 'pasiva 〜れる / 〜られる', meaning: 'pasiva («ser …-do»), a veces con perjuicio', explanation: 'El sujeto sufre la acción. En japonés también expresa molestia.', examples: [{ jp: '{雨|あめ}に{降|ふ}られた。', es: 'Me pilló la lluvia.' }] },
	{ id: 'causative', pattern: 'causativa 〜せる / 〜させる', meaning: '«hacer que / dejar que» alguien haga', explanation: '{食|た}べる → {食|た}べさせる «hacer/dejar comer».', examples: [{ jp: '{子供|こども}に{野菜|やさい}を{食|た}べさせる。', es: 'Hago que el niño coma verdura.' }] },
	{ id: 'to-iu', pattern: '〜という / 〜って', meaning: '«llamado / dicen que»', explanation: 'Cita o define. って es su versión coloquial omnipresente.', examples: [{ jp: '{田中|たなか}って{人|ひと}', es: 'una persona llamada Tanaka' }] },
	{ id: 'koto-ni', pattern: '〜ことにする / 〜ことになる', meaning: '«decidir» / «quedar decidido»', explanation: 'Decisión propia (する) o externa (なる).', examples: [{ jp: '{東京|とうきょう}に{引|ひ}っ{越|こ}すことになった。', es: 'Se decidió que me mudo a Tokio.' }] },
	{ id: 'bakari', pattern: '〜ばかり', meaning: '«nada más que / acabar de»', explanation: 'Exceso de algo, o た + ばかり «acabar de».', examples: [{ jp: '{遊|あそ}んでばかりいる。', es: 'No hace más que jugar.' }] }
];

const L4: Def[] = [
	{ id: 'causative-passive', pattern: 'causativa-pasiva 〜させられる', meaning: '«ser obligado a…»', explanation: 'Combinación causativa + pasiva: el sujeto es forzado. Coloquial: 〜される (godan).', examples: [{ jp: '{毎日|まいにち}{走|はし}らされた。', es: 'Me obligaban a correr todos los días.' }] },
	{ id: 'wake', pattern: '〜わけ / 〜わけではない', meaning: '«o sea / no es que…»', explanation: 'Conclusión lógica; わけではない niega parcialmente.', examples: [{ jp: '{嫌|きら}いなわけではない。', es: 'No es que no me guste.' }] },
	{ id: 'zu-ni', pattern: '〜ずに / 〜ず', meaning: '«sin (hacer)»', explanation: 'Negativo literario de ない: {言|い}わずに «sin decir».', examples: [{ jp: '{何|なに}も{言|い}わずに{出|で}て{行|い}った。', es: 'Se fue sin decir nada.' }] },
	{ id: 'ppoi', pattern: '〜っぽい', meaning: '«-esco / con aire de»', explanation: 'Coloquial: tendencia o parecido.', examples: [{ jp: '{子供|こども}っぽい', es: 'infantil' }] },
	{ id: 'kke', pattern: '〜っけ', meaning: '«¿era…?» (intentar recordar)', explanation: 'Pregunta a uno mismo o al otro sobre algo que se olvidó.', examples: [{ jp: '{名前|なまえ}、なんだっけ？', es: '¿Cómo se llamaba?' }] },
	{ id: 'jan', pattern: '〜じゃん', meaning: '«¿no ves que…?» (coloquial)', explanation: 'Contracción de じゃないか; muy usada en manga.', examples: [{ jp: 'いいじゃん！', es: '¡Pues está genial!' }] },
	{ id: 'zo-ze', pattern: '〜ぞ / 〜ぜ', meaning: 'énfasis enérgico (masculino)', explanation: 'Partículas finales de personajes rudos o decididos.', examples: [{ jp: '{行|い}くぞ！', es: '¡Vamos!' }] },
	{ id: 'mono', pattern: '〜もの / 〜もん', meaning: '«es que…» (justificación)', explanation: 'Excusa o razón con tono emocional, común en diálogos.', examples: [{ jp: 'だって、{怖|こわ}いもん。', es: 'Es que me da miedo.' }] },
	{ id: 'ni-yotte', pattern: '〜によって / 〜による', meaning: '«según / por (agente) / dependiendo de»', explanation: 'Frecuente en noticias y textos formales.', examples: [{ jp: '{国|くに}によって{文化|ぶんか}が{違|ちが}う。', es: 'La cultura cambia según el país.' }] },
	{ id: 'ni-tsuite', pattern: '〜について', meaning: '«acerca de / sobre»', explanation: 'Tema de una explicación o discusión.', examples: [{ jp: '{日本|にほん}の{歴史|れきし}について{調|しら}べる。', es: 'Investigo sobre la historia de Japón.' }] },
	{ id: 'toshite', pattern: '〜として', meaning: '«como / en calidad de»', explanation: 'Papel o condición de algo o alguien.', examples: [{ jp: '{先生|せんせい}として{働|はたら}く。', es: 'Trabajo como profesor.' }] },
	{ id: 'ni-totte', pattern: '〜にとって', meaning: '«para (alguien)»', explanation: 'Desde el punto de vista de alguien.', examples: [{ jp: '{私|わたし}にとって{大切|たいせつ}な{人|ひと}', es: 'una persona importante para mí' }] },
	{ id: 'uchi-ni', pattern: '〜うちに', meaning: '«mientras aún / antes de que»', explanation: 'Aprovechar un periodo antes de que cambie.', examples: [{ jp: '{熱|あつ}いうちに{食|た}べて。', es: 'Cómelo mientras está caliente.' }] },
	{ id: 'te-kuru', pattern: '〜てくる / 〜ていく', meaning: 'cambio hacia aquí / a partir de ahora', explanation: 'Dirección en el espacio o progreso en el tiempo.', examples: [{ jp: '{寒|さむ}くなってきた。', es: 'Ha empezado a hacer frío.' }] },
	{ id: 'sae', pattern: '〜さえ', meaning: '«incluso / con tal de que»', explanation: 'Extremo inesperado, o con ば: condición suficiente.', examples: [{ jp: '{名前|なまえ}さえ{知|し}らない。', es: 'Ni siquiera sé su nombre.' }] },
	{ id: 'kana-na', pattern: '〜かな / 〜かしら', meaning: '«me pregunto si…»', explanation: 'Duda en voz alta; かしら suena femenino o anticuado.', examples: [{ jp: '{明日|あした}{晴|は}れるかな。', es: '¿Hará sol mañana?' }] }
];

// Niveles 5-7 (ampliación hacia N3): lo que más aparece al LEER novela ligera, manga sin furigana y webs.
// Ver docs/grammar-expansion.md. Los ejemplos llevan furigana en todos sus kanji (lo comprueba tests/grammar.test.ts).

const L5: Def[] = [
	{ id: 'you-ni-naru', pattern: '〜ようになる', meaning: '«llegar a (poder o hacer)»', explanation: 'Cambio gradual de capacidad o costumbre.', examples: [{ jp: '{日本語|にほんご}が{話|はな}せるようになった。', es: 'Ya puedo hablar japonés.' }] },
	{ id: 'you-ni-suru', pattern: '〜ようにする', meaning: '«procurar…»', explanation: 'Esfuerzo consciente por mantener un hábito. 〜ようにしている = «suelo procurar».', examples: [{ jp: '{毎日|まいにち}{野菜|やさい}を{食|た}べるようにしている。', es: 'Procuro comer verdura todos los días.' }] },
	{ id: 'tokoro', pattern: '〜ところ', meaning: '«a punto de / justo ahora / recién»', explanation: 'Momento de la acción: る + ところ (a punto), ている + ところ (justo ahora), た + ところ (recién).', examples: [{ jp: '{今|いま}、{出|で}かけるところだ。', es: 'Justo estoy por salir.' }] },
	{ id: 'mama', pattern: '〜まま', meaning: '«tal cual / sin cambiar»', explanation: 'Un estado que se mantiene mientras pasa otra cosa.', examples: [{ jp: '{電気|でんき}をつけたまま{寝|ね}てしまった。', es: 'Me dormí con la luz encendida.' }] },
	{ id: 'temo', pattern: '〜ても / 〜でも', meaning: '«aunque / incluso si»', explanation: 'Forma て + も: la condición no cambia el resultado.', examples: [{ jp: '{雨|あめ}が{降|ふ}っても{行|い}く。', es: 'Aunque llueva, voy.' }] },
	{ id: 'tatoe-temo', pattern: 'たとえ〜ても', meaning: '«aunque (hipótesis extrema)»', explanation: 'たとえ refuerza que, incluso en el peor caso, no cambia nada.', examples: [{ jp: 'たとえ{反対|はんたい}されても、やめない。', es: 'Aunque se opongan, no lo dejaré.' }] },
	{ id: 'no-ni-tool', pattern: '〜のに (uso)', meaning: '«(sirve) para…»', explanation: 'Verbo + のに + 便利/使う/必要: para qué sirve algo. No confundir con のに «a pesar de».', examples: [{ jp: 'このはさみは{紙|かみ}を{切|き}るのに{便利|べんり}だ。', es: 'Estas tijeras son prácticas para cortar papel.' }] },
	{ id: 'koto-ga-dekiru', pattern: '〜ことができる', meaning: '«poder (forma escrita)»', explanation: 'Equivale a la forma potencial, más formal; común en avisos y explicaciones.', examples: [{ jp: 'ここで{切符|きっぷ}を{買|か}うことができる。', es: 'Aquí se pueden comprar billetes.' }] },
	{ id: 'koto-ga-aru-sometimes', pattern: '〜ことがある (presente)', meaning: '«a veces pasa que…»', explanation: 'Con forma de diccionario (no pasado): algo que ocurre de vez en cuando.', examples: [{ jp: '{朝|あさ}ご{飯|はん}を{食|た}べないことがある。', es: 'A veces no desayuno.' }] },
	{ id: 'you-to-suru', pattern: '〜ようとする', meaning: '«intentar / estar a punto de»', explanation: 'Volitiva + とする: intento, a menudo interrumpido.', examples: [{ jp: '{寝|ね}ようとしたら、{電話|でんわ}が{鳴|な}った。', es: 'Cuando iba a dormirme, sonó el teléfono.' }] },
	{ id: 'hajimeru', pattern: '〜はじめる / 〜つづける', meaning: '«empezar a / seguir…»', explanation: 'Raíz del verbo + 始める (empezar) o 続ける (continuar).', examples: [{ jp: '{雨|あめ}が{降|ふ}り{始|はじ}めた。', es: 'Empezó a llover.' }] },
	{ id: 'kiru', pattern: '〜きる', meaning: '«del todo, hasta acabar»', explanation: 'Raíz + きる: completar algo por entero. 〜きれない = no poder terminar.', examples: [{ jp: '{一晩|ひとばん}で{全部|ぜんぶ}{読|よ}みきった。', es: 'Lo leí entero en una noche.' }] },
	{ id: 'dasu', pattern: '〜だす', meaning: '«ponerse de repente a»', explanation: 'Raíz + 出す: inicio brusco, muy común en narración.', examples: [{ jp: '{急|きゅう}に{泣|な}き{出|だ}した。', es: 'De repente se echó a llorar.' }] },
	{ id: 'naosu', pattern: '〜なおす', meaning: '«volver a hacer (mejor)»', explanation: 'Raíz + 直す: rehacer para corregir.', examples: [{ jp: '{手紙|てがみ}を{書|か}き{直|なお}した。', es: 'Volví a escribir la carta.' }] },
	{ id: 'aida', pattern: '〜あいだ(に)', meaning: '«durante (un periodo)»', explanation: '間 sin に: todo el periodo; con に: en algún momento dentro de él.', examples: [{ jp: '{夏休|なつやす}みの{間|あいだ}に{本|ほん}を{十冊|じゅっさつ}{読|よ}んだ。', es: 'Durante las vacaciones de verano leí diez libros.' }] },
	{ id: 'mae-ato', pattern: '〜まえに / 〜あとで', meaning: '«antes de / después de»', explanation: 'Diccionario + 前に; pasado + 後で.', examples: [{ jp: '{寝|ね}る{前|まえ}に{歯|は}を{磨|みが}く。', es: 'Me lavo los dientes antes de dormir.' }] },
	{ id: 'te-kara', pattern: '〜てから', meaning: '«primero…, y después»', explanation: 'Orden claro: A termina y entonces B. También «desde que».', examples: [{ jp: '{宿題|しゅくだい}をしてから{遊|あそ}ぶ。', es: 'Primero hago los deberes y después juego.' }] },
	{ id: 'shi', pattern: '〜し', meaning: '«y además (razones)»', explanation: 'Enumera razones o rasgos; suele implicar «por eso…».', examples: [{ jp: '{安|やす}いし、{近|ちか}いし、この{店|みせ}がいい。', es: 'Es barato y además está cerca: esta tienda está bien.' }] },
	{ id: 'tari', pattern: '〜たり〜たりする', meaning: '«cosas como…, entre otras»', explanation: 'Ejemplos de acciones, sin lista cerrada.', examples: [{ jp: '{週末|しゅうまつ}は{映画|えいが}を{見|み}たり、{本|ほん}を{読|よ}んだりする。', es: 'Los fines de semana veo películas, leo, esas cosas.' }] },
	{ id: 'ka-dou-ka', pattern: '〜かどうか', meaning: '«si… o no»', explanation: 'Pregunta de sí/no dentro de una frase.', examples: [{ jp: '{行|い}くかどうか、まだ{分|わ}からない。', es: 'Todavía no sé si iré o no.' }] },
	{ id: 'indirect-question', pattern: '〜か (pregunta indirecta)', meaning: '«qué / dónde / cuándo… (dentro de la frase)»', explanation: 'Interrogativo + か incrustado: «no recuerdo qué…».', examples: [{ jp: '{何|なに}を{買|か}ったか{覚|おぼ}えていない。', es: 'No recuerdo qué compré.' }] },
	{ id: 'sou-ni-naru', pattern: '〜そうになる', meaning: '«estar a punto de (sin querer)»', explanation: 'Raíz + そうになる: casi pasó algo involuntario.', examples: [{ jp: '{階段|かいだん}で{転|ころ}びそうになった。', es: 'Casi me caigo en la escalera.' }] },
	{ id: 'ni-suru', pattern: '〜にする', meaning: '«elegir / decidirse por»', explanation: 'Sustantivo + にする: escoger algo (en tiendas, menús).', examples: [{ jp: '{私|わたし}はコーヒーにします。', es: 'Yo me decido por un café.' }] },
	{ id: 'naru', pattern: '〜くなる / 〜になる', meaning: '«volverse / ponerse»', explanation: 'Adjetivo -i → く + なる; sustantivo o -na + に + なる.', examples: [{ jp: '{急|きゅう}に{寒|さむ}くなった。', es: 'De repente se puso frío.' }] },
	{ id: 'sasete-kudasai', pattern: '〜させてください', meaning: '«déjeme…, permítame…»', explanation: 'Causativa + てください: pedir permiso para hacer algo uno mismo.', examples: [{ jp: '{私|わたし}にやらせてください。', es: 'Déjeme hacerlo a mí.' }] },
	{ id: 'te-hoshii', pattern: '〜てほしい', meaning: '«quiero que (otro) haga»', explanation: 'Deseo sobre la acción de otra persona (〜たい es para uno mismo).', examples: [{ jp: '{早|はや}く{帰|かえ}ってきてほしい。', es: 'Quiero que vuelvas pronto.' }] },
	{ id: 'garu', pattern: '〜がる', meaning: '«mostrar (un sentimiento), en tercera persona»', explanation: 'Adjetivo de sentimiento + がる: lo que otro muestra sentir (怖がる, 欲しがる).', examples: [{ jp: '{弟|おとうと}が{犬|いぬ}を{欲|ほ}しがっている。', es: 'Mi hermano pequeño se muere por tener un perro.' }] },
	{ id: 'nasai', pattern: '〜なさい', meaning: '«¡haz…! (orden de padres o profesores)»', explanation: 'Raíz + なさい: orden firme pero educada, de arriba abajo.', examples: [{ jp: '{早|はや}く{寝|ね}なさい。', es: '¡A dormir ya!' }] },
	{ id: 'imperative', pattern: 'imperativo 〜ろ / 〜え', meaning: 'orden brusca («¡haz!»)', explanation: 'Típico de manga, peleas y carteles de peligro: 逃げろ, 止まれ, 行け.', examples: [{ jp: '{危|あぶ}ない！{逃|に}げろ！', es: '¡Peligro! ¡Huye!' }] },
	{ id: 'na-prohibition', pattern: '〜な (prohibición)', meaning: '«¡no hagas…!»', explanation: 'Diccionario + な: prohibición tajante. No confundir con な de los adjetivos.', examples: [{ jp: '{動|うご}くな！', es: '¡No te muevas!' }] },
	{ id: 'dake-de', pattern: '〜だけで', meaning: '«solo con…»', explanation: 'Basta con eso para que ocurra lo siguiente.', examples: [{ jp: '{考|かんが}えるだけで{怖|こわ}い。', es: 'Solo de pensarlo me da miedo.' }] },
	{ id: 'koso', pattern: '〜こそ', meaning: '«precisamente este (y no otro)»', explanation: 'Destaca con fuerza: 今度こそ «esta vez sí».', examples: [{ jp: '{今度|こんど}こそ{勝|か}つ。', es: 'Esta vez sí que gano.' }] },
	{ id: 'demo-suggest', pattern: '〜でも (sugerencia)', meaning: '«…o algo así»', explanation: 'Suaviza una propuesta dando un ejemplo: お茶でも «un té o algo».', examples: [{ jp: 'お{茶|ちゃ}でも{飲|の}みませんか。', es: '¿Tomamos un té o algo?' }] },
	{ id: 'nanka', pattern: '〜なんか / 〜など', meaning: '«cosas como… (a veces con desdén)»', explanation: 'など es neutro; なんか coloquial y a menudo despectivo o humilde.', examples: [{ jp: '{僕|ぼく}なんか{無理|むり}だよ。', es: 'Alguien como yo no puede.' }] },
	{ id: 'kurai', pattern: '〜くらい / 〜ぐらい', meaning: '«unos… / hasta el punto de»', explanation: 'Cantidad aproximada o grado extremo.', examples: [{ jp: '{泣|な}きたいくらい{嬉|うれ}しい。', es: 'Estoy tan feliz que quiero llorar.' }] },
	{ id: 'ba-hodo', pattern: '〜ば〜ほど', meaning: '«cuanto más…, más…»', explanation: 'Condicional + misma palabra + ほど.', examples: [{ jp: '{考|かんが}えれば{考|かんが}えるほど{分|わ}からなくなる。', es: 'Cuanto más lo pienso, menos lo entiendo.' }] },
	{ id: 'naide', pattern: '〜ないで / 〜なくて', meaning: '«sin… (coloquial) / como no…»', explanation: 'ないで: sin hacer, o «no hagas» (ないでください). なくて: causa negativa.', examples: [{ jp: '{朝|あさ}ご{飯|はん}を{食|た}べないで{出|で}かけた。', es: 'Salí sin desayunar.' }] },
	{ id: 'to-omou', pattern: '〜と{思|おも}う', meaning: '«creo que…»', explanation: 'Opinión del hablante; en tercera persona, と思っている.', examples: [{ jp: '{明日|あした}は{雨|あめ}だと{思|おも}う。', es: 'Creo que mañana lloverá.' }] },
	{ id: 'you-to-omou', pattern: '〜(よ)うと{思|おも}う', meaning: '«estoy pensando en (hacer)»', explanation: 'Volitiva + と思う: intención que va tomando forma.', examples: [{ jp: '{夏|なつ}に{旅行|りょこう}しようと{思|おも}っている。', es: 'Estoy pensando en viajar en verano.' }] },
	{ id: 'ta-totan', pattern: '〜たとたん', meaning: '«justo en el momento en que»', explanation: 'Pasado + とたん: algo inesperado sucede enseguida.', examples: [{ jp: '{外|そと}に{出|で}たとたん、{雨|あめ}が{降|ふ}り{出|だ}した。', es: 'Nada más salir, se puso a llover.' }] },
	{ id: 'ba-yokatta', pattern: '〜ばよかった', meaning: '«ojalá hubiera…»', explanation: 'Arrepentimiento: lo que debería haberse hecho.', examples: [{ jp: 'もっと{早|はや}く{来|く}ればよかった。', es: 'Ojalá hubiera venido antes.' }] },
	{ id: 'mitai-na', pattern: '〜みたいな / 〜ような', meaning: '«como… (comparación ante un sustantivo)»', explanation: 'Compara o pone ejemplo: 夢みたいな話 «una historia como de sueño».', examples: [{ jp: '{夢|ゆめ}みたいな{話|はなし}だ。', es: 'Es como un sueño.' }] }
];

const L6: Def[] = [
	{ id: 'sonkeigo', pattern: 'いらっしゃる / おっしゃる / なさる', meaning: 'verbos de respeto (keigo honorífico)', explanation: 'Sustituyen a いる・行く・来る, 言う y する cuando el sujeto es alguien superior.', examples: [{ jp: '{社長|しゃちょう}がそうおっしゃいました。', es: 'El presidente dijo eso.' }] },
	{ id: 'o-ni-naru', pattern: 'お〜になる', meaning: 'respeto regular («usted…»)', explanation: 'お + raíz + になる: honorífico para casi cualquier verbo.', examples: [{ jp: '{先生|せんせい}はもうお{帰|かえ}りになりました。', es: 'El profesor ya se ha ido a casa.' }] },
	{ id: 'kenjougo', pattern: 'まいる / いたす / もうす', meaning: 'verbos de humildad (keigo humilde)', explanation: 'El hablante se rebaja: 行く・来る→参る, する→いたす, 言う→申す.', examples: [{ jp: '{田中|たなか}と{申|もう}します。', es: 'Me llamo Tanaka.' }] },
	{ id: 'o-suru', pattern: 'お〜する', meaning: 'humildad regular («permítame…»)', explanation: 'お + raíz + する: el hablante hace algo para el otro.', examples: [{ jp: 'お{荷物|にもつ}をお{持|も}ちします。', es: 'Le llevo el equipaje.' }] },
	{ id: 'gozaimasu', pattern: 'ございます / でございます', meaning: '«hay / es» (muy cortés)', explanation: 'Forma de tiendas, hoteles y anuncios para ある y です.', examples: [{ jp: 'お{手洗|てあら}いはこちらでございます。', es: 'El baño está por aquí.' }] },
	{ id: 'rareru-respect', pattern: '〜れる / 〜られる (respeto)', meaning: 'pasiva usada como respeto', explanation: 'La forma pasiva también eleva al sujeto, típico en empresa y noticias.', examples: [{ jp: '{部長|ぶちょう}は{何時|なんじ}に{来|こ}られますか。', es: '¿A qué hora vendrá el jefe?' }] },
	{ id: 'ni-chigainai', pattern: '〜にちがいない', meaning: '«seguro que (convencido)»', explanation: 'Certeza fuerte del hablante, frecuente en novela negra.', examples: [{ jp: '{犯人|はんにん}は{彼|かれ}に{違|ちが}いない。', es: 'El culpable tiene que ser él.' }] },
	{ id: 'wake-ga-nai', pattern: '〜わけがない', meaning: '«es imposible que»', explanation: 'Niega con rotundidad que algo pueda ser.', examples: [{ jp: 'そんなことがあるわけがない。', es: 'Es imposible que pase algo así.' }] },
	{ id: 'wake-ni-wa-ikanai', pattern: '〜わけにはいかない', meaning: '«no puedo permitirme…»', explanation: 'Razones sociales o morales lo impiden.', examples: [{ jp: 'ここで{諦|あきら}めるわけにはいかない。', es: 'No puedo rendirme aquí.' }] },
	{ id: 'beki', pattern: '〜べき', meaning: '«debería (moralmente)»', explanation: 'Deber u opinión firme. べきではない = no se debería.', examples: [{ jp: '{約束|やくそく}は{守|まも}るべきだ。', es: 'Las promesas hay que cumplirlas.' }] },
	{ id: 'sei-okage', pattern: '〜せいで / 〜おかげで', meaning: '«por culpa de / gracias a»', explanation: 'Misma estructura, causa mala (せい) o buena (おかげ).', examples: [{ jp: '{君|きみ}のおかげで{助|たす}かった。', es: 'Gracias a ti me salvé.' }] },
	{ id: 'kuse-ni', pattern: '〜くせに', meaning: '«y encima… (con desprecio)»', explanation: 'Reproche: alguien actúa contra lo que se espera de él.', examples: [{ jp: '{知|し}っているくせに、{教|おし}えてくれない。', es: 'Lo sabe y aun así no me lo dice.' }] },
	{ id: 'monono', pattern: '〜ものの', meaning: '«si bien…, (sin embargo)»', explanation: 'Admite algo pero el resultado no es el esperado; estilo escrito.', examples: [{ jp: '{買|か}ったものの、まだ{一度|いちど}も{使|つか}っていない。', es: 'Si bien lo compré, todavía no lo he usado ni una vez.' }] },
	{ id: 'ni-shite-wa', pattern: '〜にしては', meaning: '«para ser… (sorprende)»', explanation: 'El resultado no encaja con lo esperado de esa condición.', examples: [{ jp: '{初|はじ}めてにしては{上手|じょうず}だ。', es: 'Para ser la primera vez, lo hace bien.' }] },
	{ id: 'tabi-ni', pattern: '〜たびに', meaning: '«cada vez que»', explanation: 'Siempre que ocurre A, ocurre B.', examples: [{ jp: 'この{歌|うた}を{聞|き}くたびに{泣|な}いてしまう。', es: 'Cada vez que oigo esta canción, lloro.' }] },
	{ id: 'to-tomo-ni', pattern: '〜とともに', meaning: '«junto con (formal)»', explanation: 'Acompañamiento o simultaneidad en textos escritos.', examples: [{ jp: '{時代|じだい}とともに{言葉|ことば}も{変|か}わる。', es: 'Con los tiempos, también cambia el lenguaje.' }] },
	{ id: 'ni-tsurete', pattern: '〜につれて', meaning: '«a medida que»', explanation: 'Un cambio arrastra a otro de forma gradual.', examples: [{ jp: '{年|とし}を{取|と}るにつれて、{体|からだ}が{弱|よわ}くなる。', es: 'A medida que envejeces, el cuerpo se debilita.' }] },
	{ id: 'ni-kanshite', pattern: '〜に{関|かん}して', meaning: '«respecto a (formal, escrito)»', explanation: 'Versión formal de について: informes, noticias, instrucciones.', examples: [{ jp: 'この{件|けん}に{関|かん}して{質問|しつもん}があります。', es: 'Tengo una pregunta respecto a este asunto.' }] },
	{ id: 'ni-taishite', pattern: '〜に{対|たい}して', meaning: '«hacia / frente a / en contraste con»', explanation: 'Destinatario de una actitud, o contraste entre dos cosas.', examples: [{ jp: '{先生|せんせい}に{対|たい}して{失礼|しつれい}だ。', es: 'Es una falta de respeto hacia el profesor.' }] },
	{ id: 'ni-yoru-to', pattern: '〜によると / 〜によれば', meaning: '«según dice (fuente de información)»', explanation: 'Introduce la fuente de un rumor o noticia; suele terminar en そうだ/らしい.', examples: [{ jp: '{天気予報|てんきよほう}によると、{明日|あした}は{雪|ゆき}だそうだ。', es: 'Según el pronóstico, mañana nevará.' }] },
	{ id: 'kawari-ni', pattern: '〜かわりに', meaning: '«en vez de / a cambio de»', explanation: 'Sustitución o compensación.', examples: [{ jp: '{肉|にく}の{代|か}わりに{魚|さかな}を{食|た}べる。', es: 'Como pescado en vez de carne.' }] },
	{ id: 'dake-de-naku', pattern: '〜だけでなく / 〜ばかりか', meaning: '«no solo… sino también»', explanation: 'Añade un elemento, a menudo más sorprendente.', examples: [{ jp: '{彼|かれ}は{英語|えいご}だけでなく{中国語|ちゅうごくご}も{話|はな}せる。', es: 'No solo habla inglés, sino también chino.' }] },
	{ id: 'ippou-de', pattern: '〜{一方|いっぽう}で', meaning: '«por otro lado / mientras que»', explanation: 'Dos caras de una misma cosa; típico de textos de opinión.', examples: [{ jp: '{都会|とかい}は{便利|べんり}な{一方|いっぽう}で、{物価|ぶっか}が{高|たか}い。', es: 'La ciudad es práctica; por otro lado, todo es caro.' }] },
	{ id: 'kara-koso', pattern: '〜からこそ', meaning: '«justamente porque»', explanation: 'Destaca la razón como la verdadera causa.', examples: [{ jp: '{好|す}きだからこそ{厳|きび}しくする。', es: 'Precisamente porque me importa, soy estricto.' }] },
	{ id: 'to-shite-mo', pattern: '〜としても', meaning: '«incluso suponiendo que»', explanation: 'Hipótesis que no cambia la conclusión.', examples: [{ jp: '{今|いま}から{走|はし}ったとしても{間|ま}に{合|あ}わない。', es: 'Aunque corriera ahora, no llegaría a tiempo.' }] },
	{ id: 'mono-da', pattern: '〜ものだ', meaning: '«solía… (nostalgia) / así son las cosas»', explanation: 'Con pasado: recuerdo nostálgico; con presente: lo natural o lo que se debe.', examples: [{ jp: '{子供|こども}の{頃|ころ}はよくここで{遊|あそ}んだものだ。', es: 'De niño solía jugar mucho aquí.' }] },
	{ id: 'koto-da', pattern: '〜ことだ', meaning: '«lo que hay que hacer es…»', explanation: 'Consejo firme del hablante.', examples: [{ jp: '{上手|じょうず}になりたければ、{毎日|まいにち}{練習|れんしゅう}することだ。', es: 'Si quieres mejorar, lo que tienes que hacer es practicar cada día.' }] },
	{ id: 'you-ni-iu', pattern: '〜ように{言|い}う', meaning: '«decir (a alguien) que haga»', explanation: 'Orden o consejo en estilo indirecto; con pasiva, «me dijeron que…».', examples: [{ jp: '{医者|いしゃ}にお{酒|さけ}を{飲|の}まないように{言|い}われた。', es: 'El médico me dijo que no bebiera alcohol.' }] },
	{ id: 'ni-suginai', pattern: '〜にすぎない', meaning: '«no es más que»', explanation: 'Resta importancia; estilo escrito.', examples: [{ jp: 'それはただの{噂|うわさ}にすぎない。', es: 'Eso no es más que un rumor.' }] },
	{ id: 'ni-kagiru', pattern: '〜に{限|かぎ}る', meaning: '«lo mejor es… / solo para…»', explanation: 'Lo ideal en una situación, o una limitación (会員に限る).', examples: [{ jp: '{疲|つか}れたときは{寝|ね}るに{限|かぎ}る。', es: 'Cuando estás cansado, lo mejor es dormir.' }] },
	{ id: 'wo-hajime', pattern: '〜をはじめ', meaning: '«empezando por»', explanation: 'Cita el ejemplo principal de un grupo.', examples: [{ jp: '{東京|とうきょう}をはじめ、{多|おお}くの{都市|とし}で{雪|ゆき}が{降|ふ}った。', es: 'Nevó en muchas ciudades, empezando por Tokio.' }] },
	{ id: 'ni-oite', pattern: '〜において', meaning: '«en (lugar o ámbito, formal)»', explanation: 'Equivale a で en textos oficiales y noticias.', examples: [{ jp: '{会議|かいぎ}は{本社|ほんしゃ}において{行|おこな}われる。', es: 'La reunión se celebrará en la sede central.' }] },
	{ id: 'ni-shiro', pattern: '〜にしろ / 〜にせよ', meaning: '«ya sea… o… / en cualquier caso»', explanation: 'Sea cual sea la opción, la conclusión no cambia.', examples: [{ jp: '{行|い}くにしろ{行|い}かないにしろ、{連絡|れんらく}して。', es: 'Vayas o no, avísame.' }] },
	{ id: 'te-irai', pattern: '〜て{以来|いらい}', meaning: '«desde que (hasta hoy)»', explanation: 'Situación que se mantiene desde un momento pasado.', examples: [{ jp: '{日本|にほん}に{来|き}て{以来|いらい}、{毎日|まいにち}{和食|わしょく}だ。', es: 'Desde que llegué a Japón, como comida japonesa a diario.' }] },
	{ id: 'osore', pattern: '〜おそれがある', meaning: '«existe el riesgo de»', explanation: 'Advertencia formal (noticias, partes meteorológicos).', examples: [{ jp: '{台風|たいふう}が{上陸|じょうりく}するおそれがある。', es: 'Existe el riesgo de que el tifón toque tierra.' }] },
	{ id: 'ni-kakawarazu', pattern: '〜にかかわらず', meaning: '«independientemente de»', explanation: 'Sin que importe la condición (年齢にかかわらず).', examples: [{ jp: '{年齢|ねんれい}にかかわらず、{誰|だれ}でも{参加|さんか}できる。', es: 'Puede participar cualquiera, independientemente de la edad.' }] }
];

const L7: Def[] = [
	{ id: 'de-aru', pattern: '〜である', meaning: '«es» (estilo escrito)', explanation: 'Sustituye a だ/です en ensayos, artículos y narración clásica.', examples: [{ jp: '{吾輩|わがはい}は{猫|ねこ}である。', es: 'Yo soy un gato. (Natsume Sōseki)' }] },
	{ id: 'nu', pattern: '〜ぬ / 〜ん', meaning: '«no» (negación arcaica)', explanation: 'Negación antigua que sobrevive en expresiones y personajes mayores: 知らぬ, 分からん.', examples: [{ jp: '{知|し}らぬ{間|ま}に{時間|じかん}が{過|す}ぎていた。', es: 'Sin darme cuenta, había pasado el tiempo.' }] },
	{ id: 'zaru-wo-enai', pattern: '〜ざるを{得|え}ない', meaning: '«no queda más remedio que»', explanation: 'Forma ない sin ない + ざるを得ない (する → せざるを得ない).', examples: [{ jp: '{雨|あめ}で{試合|しあい}を{中止|ちゅうし}せざるを{得|え}ない。', es: 'Por la lluvia, no queda más remedio que suspender el partido.' }] },
	{ id: 'mai', pattern: '〜まい', meaning: '«no… (voluntad o suposición negativa)»', explanation: 'Literario: «no lo haré» o «seguramente no».', examples: [{ jp: 'もう{二度|にど}と{行|い}くまい。', es: 'No volveré nunca más.' }] },
	{ id: 'beku', pattern: '〜べく', meaning: '«con el fin de (formal)»', explanation: 'Finalidad en estilo escrito; する → すべく.', examples: [{ jp: '{夢|ゆめ}を{叶|かな}えるべく、{努力|どりょく}を{続|つづ}ける。', es: 'Para cumplir su sueño, sigue esforzándose.' }] },
	{ id: 'tsutsu', pattern: '〜つつ', meaning: '«aun… / mientras (literario)»', explanation: 'Simultaneidad escrita o contradicción: 悪いと知りつつ «aun sabiendo que está mal».', examples: [{ jp: '{悪|わる}いと{知|し}りつつ、やめられない。', es: 'Aun sabiendo que está mal, no puedo dejarlo.' }] },
	{ id: 'tsutsu-aru', pattern: '〜つつある', meaning: '«está en proceso de»', explanation: 'Cambio que avanza poco a poco; noticias y ensayos.', examples: [{ jp: '{状況|じょうきょう}は{少|すこ}しずつ{変|か}わりつつある。', es: 'La situación está cambiando poco a poco.' }] },
	{ id: 'ka-no-you-ni', pattern: '〜かのように', meaning: '«como si (irreal, literario)»', explanation: 'Comparación con algo que no es verdad.', examples: [{ jp: '{何|なに}もなかったかのように{笑|わら}った。', es: 'Sonrió como si no hubiera pasado nada.' }] },
	{ id: 'ni-mo-kakawarazu', pattern: '〜にもかかわらず', meaning: '«a pesar de (formal)»', explanation: 'Contraste fuerte en textos escritos.', examples: [{ jp: '{雨|あめ}にもかかわらず、{大勢|おおぜい}の{人|ひと}が{集|あつ}まった。', es: 'A pesar de la lluvia, se reunió mucha gente.' }] },
	{ id: 'nagara-mo', pattern: '〜ながらも', meaning: '«aunque… (concesivo)»', explanation: 'Dos rasgos que conviven pese a contrastar.', examples: [{ jp: '{狭|せま}いながらも{楽|たの}しい{我|わ}が{家|や}。', es: 'Nuestra casa, aunque pequeña, es alegre.' }] },
	{ id: 'ya-ina-ya', pattern: '〜や{否|いな}や', meaning: '«nada más… (al instante)»', explanation: 'Inmediatez en narración; equivale a たとたん pero literario.', examples: [{ jp: '{家|いえ}に{着|つ}くや{否|いな}や、{寝|ね}てしまった。', es: 'Nada más llegar a casa, se quedó dormido.' }] },
	{ id: 'ni-hoka-naranai', pattern: '〜にほかならない', meaning: '«no es otra cosa que»', explanation: 'Afirma con rotundidad la verdadera causa o naturaleza.', examples: [{ jp: '{成功|せいこう}は{努力|どりょく}の{結果|けっか}にほかならない。', es: 'El éxito no es otra cosa que el fruto del esfuerzo.' }] },
	{ id: 'to-wa', pattern: '〜とは', meaning: '«¡que…! (sorpresa) / lo que se llama…»', explanation: 'Sorpresa ante un hecho, o definición (愛とは何か).', examples: [{ jp: 'まさか{彼|かれ}が{来|く}るとは。', es: '¡Quién iba a pensar que él vendría!' }] },
	{ id: 'nante', pattern: '〜なんて', meaning: '«¡mira que…! (sorpresa o desdén)»', explanation: 'Valoración emocional de lo dicho, muy de manga.', examples: [{ jp: '{一人|ひとり}で{行|い}くなんて{危|あぶ}ないよ。', es: '¡Mira que ir solo! Es peligroso.' }] },
	{ id: 'tteba', pattern: '〜ってば / 〜ったら', meaning: '«¡que ya te dije! (impaciencia)»', explanation: 'Insistencia o reproche cariñoso al final de la frase o tras un nombre.', examples: [{ jp: 'もう、{分|わ}かったってば！', es: '¡Que sí, que ya lo entendí!' }] },
	{ id: 'dewa-nai-ka', pattern: '〜ではないか', meaning: '«¿acaso no…? (retórico, escrito)»', explanation: 'Afirmación disfrazada de pregunta; también «¡hagamos…!» con volitiva.', examples: [{ jp: 'これこそ{本物|ほんもの}の{名作|めいさく}ではないか。', es: '¿No es esta, precisamente, una auténtica obra maestra?' }] },
	{ id: 'gimi', pattern: '〜ぎみ', meaning: '«algo / con tendencia a (leve)»', explanation: 'Un poco de algo, a menudo negativo: 風邪気味 «medio resfriado».', examples: [{ jp: '{最近|さいきん}、{少|すこ}し{風邪|かぜ}{気味|ぎみ}だ。', es: 'Últimamente estoy un poco acatarrado.' }] },
	{ id: 'gachi', pattern: '〜がち', meaning: '«suele… (tendencia no deseada)»', explanation: 'Raíz o sustantivo + がち: algo que pasa con frecuencia, sin querer.', examples: [{ jp: '{冬|ふゆ}は{家|いえ}にこもりがちだ。', es: 'En invierno tiendo a encerrarme en casa.' }] },
	{ id: 'darake', pattern: '〜だらけ', meaning: '«lleno de (algo malo)»', explanation: 'Cubierto o plagado: 傷だらけ, 間違いだらけ.', examples: [{ jp: 'この{作文|さくぶん}は{間違|まちが}いだらけだ。', es: 'Esta redacción está llena de errores.' }] },
	{ id: 'kai-dai', pattern: '〜かい / 〜だい', meaning: 'pregunta cercana (habla masculina o mayor)', explanation: 'Versiones amables de か: 元気かい？, 何だい？', examples: [{ jp: '{元気|げんき}かい？', es: '¿Qué tal estás?' }] },
	{ id: 'wa-final', pattern: '〜わ (final)', meaning: 'final femenino o de énfasis', explanation: 'Suaviza o enfatiza; en Tokio suena femenino, en Kansai lo usa cualquiera.', examples: [{ jp: '{素敵|すてき}だわ。', es: '¡Qué maravilla!' }] },
	{ id: 'sa-final', pattern: '〜さ (final)', meaning: '«pues… (tono despreocupado)»', explanation: 'Final casual, típico de personajes relajados o seguros de sí.', examples: [{ jp: '{大丈夫|だいじょうぶ}さ。', es: 'Tranquilo, no pasa nada.' }] },
	{ id: 'kansai', pattern: '〜や / 〜へん (Kansai)', meaning: 'dialecto de Kansai (や = だ, へん = ない)', explanation: 'Muy presente en manga y anime: ほんま (de verdad), あかん (no vale), 〜ねん (énfasis).', examples: [{ jp: 'そんなん{知|し}らへんわ。ほんまや。', es: 'Eso no lo sé. De verdad.' }] },
	{ id: 'giongo', pattern: 'onomatopeyas (ドキドキ, キラキラ…)', meaning: 'onomatopeyas de sonido y de estado', explanation: 'Imitan sonidos (ワンワン) o describen estados (ドキドキ nervios, イライラ irritación, キラキラ brillo). Clave en manga.', examples: [{ jp: '{緊張|きんちょう}で{心臓|しんぞう}がドキドキする。', es: 'Del nervio, el corazón me late a mil.' }] },
	{ id: 'you-ga', pattern: '〜(よ)うが / 〜(よ)うと', meaning: '«da igual que… / por mucho que»', explanation: 'Volitiva + が/と: nada cambia la decisión.', examples: [{ jp: '{誰|だれ}が{何|なん}と{言|い}おうが、{私|わたし}は{行|い}く。', es: 'Diga quien diga lo que diga, yo voy.' }] },
	{ id: 'made-mo-nai', pattern: '〜までもない', meaning: '«no hace falta (ni)»', explanation: 'Algo tan obvio que no merece hacerse: 言うまでもない «ni que decir tiene».', examples: [{ jp: '{言|い}うまでもなく、{健康|けんこう}が{一番|いちばん}{大切|たいせつ}だ。', es: 'Ni que decir tiene que la salud es lo más importante.' }] },
	{ id: 'kiri', pattern: '〜きり / 〜っきり', meaning: '«desde que… no (más) / solo»', explanation: 'Pasado + きり: algo pasó y no volvió a pasar. 二人きり «a solas».', examples: [{ jp: '{彼|かれ}とは{去年|きょねん}{会|あ}ったきりだ。', es: 'Solo lo vi una vez, el año pasado, y ya no más.' }] },
	{ id: 'sura', pattern: '〜すら', meaning: '«ni siquiera (formal)»', explanation: 'Versión escrita de さえ: extremo mínimo que tampoco se cumple.', examples: [{ jp: '{自分|じぶん}の{名前|なまえ}すら{書|か}けない。', es: 'Ni siquiera sabe escribir su propio nombre.' }] },
	{ id: 'tomo-naku', pattern: '〜ともなく / 〜ともなしに', meaning: '«sin proponérselo»', explanation: 'Hacer algo distraídamente: 見るともなく «mirando sin mirar».', examples: [{ jp: '{窓|まど}の{外|そと}を{見|み}るともなく{見|み}ていた。', es: 'Miraba por la ventana sin mirar nada en concreto.' }] },
	{ id: 'ni-shite', pattern: '〜にして', meaning: '«a (tal edad) / en tan solo»', explanation: 'Momento o etapa notable: 十歳にして «con apenas diez años».', examples: [{ jp: '{彼|かれ}は{十歳|じゅっさい}にしてプロになった。', es: 'Se hizo profesional con apenas diez años.' }] },
	{ id: 'ni-tsuki', pattern: '〜につき', meaning: '«por (motivo) / por cada (avisos)»', explanation: 'Típico de carteles: 工事中につき «por obras»; 一人につき «por persona».', examples: [{ jp: '{工事中|こうじちゅう}につき{通行止|つうこうど}め。', es: 'Cerrado al paso por obras.' }] }
];

const LEVELS: [Def[], number, number][] = [
	// [puntos, nivel, kanji para el primero del nivel]; dentro del nivel se escalonan.
	[L1, 1, 0],
	[L2, 2, 40],
	[L3, 3, 150],
	[L4, 4, 350],
	[L5, 5, 500],
	[L6, 6, 800],
	[L7, 7, 1200]
];

const STEP: Record<number, number> = { 1: 2, 2: 6, 3: 10, 4: 15, 5: 7, 6: 10, 7: 15 };

export const GRAMMAR: GrammarPoint[] = LEVELS.flatMap(([defs, level, base]) =>
	defs.map((d, i) => ({ ...d, level, unlockAt: base + i * STEP[level] }))
);

export const GRAMMAR_BY_ID = new Map(GRAMMAR.map((g) => [g.id, g]));

export function grammarPlain(jp: string) {
	return jp.replace(/\{([^|{}]+)\|[^{}]+\}/g, '$1');
}
