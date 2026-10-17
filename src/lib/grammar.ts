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

const LEVELS: [Def[], number, number][] = [
	// [puntos, nivel, kanji para el primero del nivel]; dentro del nivel se escalonan.
	[L1, 1, 0],
	[L2, 2, 40],
	[L3, 3, 150],
	[L4, 4, 350]
];

const STEP: Record<number, number> = { 1: 2, 2: 6, 3: 10, 4: 15 };

export const GRAMMAR: GrammarPoint[] = LEVELS.flatMap(([defs, level, base]) =>
	defs.map((d, i) => ({ ...d, level, unlockAt: base + i * STEP[level] }))
);

export const GRAMMAR_BY_ID = new Map(GRAMMAR.map((g) => [g.id, g]));

export function grammarPlain(jp: string) {
	return jp.replace(/\{([^|{}]+)\|[^{}]+\}/g, '$1');
}
