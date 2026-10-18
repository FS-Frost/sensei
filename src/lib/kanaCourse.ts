// Curso de kana desde cero: filas en orden de enseñanza, mnemotecnias en español, palabra de ejemplo, parecidos y
// reglas (dakuten, combinados, っ, ー, katakana extendido). Contenido fijo, curado a mano: funciona sin IA.
// Las claves de tarjeta son el propio kana (あ, きゃ, ファ); っ/ッ y ー se practican con palabras de ejemplo.
import { toRomaji } from 'wanakana';

export type KanaScript = 'hiragana' | 'katakana';
export type KanaGroup = 'basic' | 'dakuten' | 'yoon' | 'special' | 'extended';

export type KanaRow = {
	id: string;
	script: KanaScript;
	group: KanaGroup;
	/** «Fila か (ka)», «Combinados con き»… */
	title: string;
	chars: string[];
};

export type KanaEntry = {
	/** Romaji principal (Hepburn). */
	romaji: string;
	/** Imagen para recordar la forma y el sonido (solo los básicos; el resto se explica por regla). */
	mnemonic?: string;
	/** Palabra común que lo usa, escrita en kana, con su significado. */
	example?: { word: string; es: string };
};

/** Reglas por grupo: se muestran con el primer kana de cada fila de ese grupo. */
export const KANA_RULES: Record<Exclude<KanaGroup, 'basic'>, string> = {
	dakuten:
		'Las dos rayitas ゛ (dakuten) vuelven sonora la consonante: k→g (か→が), s→z (さ→ざ), t→d (た→だ), h→b (は→ば). El circulito ゜ (handakuten) convierte h→p (は→ぱ). ぢ y づ suenan como じ y ず y casi no se usan.',
	yoon: 'Una ゃ ゅ ょ pequeña junta dos kana en una sola sílaba: き + ゃ = きゃ (kya), し + ょ = しょ (sho). Fíjate en el tamaño: きや (ki-ya) son dos sílabas; きゃ, una.',
	special:
		'La っ pequeña es una pausa breve que duplica la consonante siguiente: きって = ki-t-te («sello»). En katakana, la raya ー alarga la vocal anterior: コーヒー = koohii («café»).',
	extended:
		'Para sonidos que el japonés no tiene, el katakana combina un kana con una vocal pequeña: フ + ァ = ファ (fa), テ + ィ = ティ (ti), シ + ェ = シェ (she). Aparecen en palabras extranjeras.'
};

const H = (id: string, title: string, chars: string, group: KanaGroup = 'basic'): KanaRow => ({
	id: `h-${id}`,
	script: 'hiragana',
	group,
	title,
	chars: [...chars.matchAll(/.[ゃゅょぁぃぅぇぉ]?/gu)].map((m) => m[0])
});
const K = (id: string, title: string, chars: string, group: KanaGroup = 'basic'): KanaRow => ({
	id: `k-${id}`,
	script: 'katakana',
	group,
	title,
	chars: [...chars.matchAll(/.[ャュョァィゥェォ]?/gu)].map((m) => m[0])
});

/** Orden del curso: hiragana (básico → dakuten → combinados → っ) y luego katakana (igual, más ー y extendidos). */
export const KANA_ROWS: KanaRow[] = [
	H('a', 'Vocales あ (a)', 'あいうえお'),
	H('ka', 'Fila か (ka)', 'かきくけこ'),
	H('sa', 'Fila さ (sa)', 'さしすせそ'),
	H('ta', 'Fila た (ta)', 'たちつてと'),
	H('na', 'Fila な (na)', 'なにぬねの'),
	H('ha', 'Fila は (ha)', 'はひふへほ'),
	H('ma', 'Fila ま (ma)', 'まみむめも'),
	H('ya', 'Fila や (ya)', 'やゆよ'),
	H('ra', 'Fila ら (ra)', 'らりるれろ'),
	H('wa', 'わ, を y ん', 'わをん'),
	H('ga', 'Con ゛: が (ga)', 'がぎぐげご', 'dakuten'),
	H('za', 'Con ゛: ざ (za)', 'ざじずぜぞ', 'dakuten'),
	H('da', 'Con ゛: だ (da)', 'だぢづでど', 'dakuten'),
	H('ba', 'Con ゛: ば (ba)', 'ばびぶべぼ', 'dakuten'),
	H('pa', 'Con ゜: ぱ (pa)', 'ぱぴぷぺぽ', 'dakuten'),
	H('kya', 'Combinados: きゃ, ぎゃ', 'きゃきゅきょぎゃぎゅぎょ', 'yoon'),
	H('sha', 'Combinados: しゃ, じゃ', 'しゃしゅしょじゃじゅじょ', 'yoon'),
	H('cha', 'Combinados: ちゃ, にゃ', 'ちゃちゅちょにゃにゅにょ', 'yoon'),
	H('hya', 'Combinados: ひゃ, びゃ, ぴゃ', 'ひゃひゅひょびゃびゅびょぴゃぴゅぴょ', 'yoon'),
	H('mya', 'Combinados: みゃ, りゃ', 'みゃみゅみょりゃりゅりょ', 'yoon'),
	H('tsu', 'La っ pequeña', 'っ', 'special'),
	K('a', 'Vocales ア (a)', 'アイウエオ'),
	K('ka', 'Fila カ (ka)', 'カキクケコ'),
	K('sa', 'Fila サ (sa)', 'サシスセソ'),
	K('ta', 'Fila タ (ta)', 'タチツテト'),
	K('na', 'Fila ナ (na)', 'ナニヌネノ'),
	K('ha', 'Fila ハ (ha)', 'ハヒフヘホ'),
	K('ma', 'Fila マ (ma)', 'マミムメモ'),
	K('ya', 'Fila ヤ (ya)', 'ヤユヨ'),
	K('ra', 'Fila ラ (ra)', 'ラリルレロ'),
	K('wa', 'ワ, ヲ y ン', 'ワヲン'),
	K('ga', 'Con ゛: ガ (ga)', 'ガギグゲゴ', 'dakuten'),
	K('za', 'Con ゛: ザ (za)', 'ザジズゼゾ', 'dakuten'),
	K('da', 'Con ゛: ダ (da)', 'ダヂヅデド', 'dakuten'),
	K('ba', 'Con ゛: バ (ba)', 'バビブベボ', 'dakuten'),
	K('pa', 'Con ゜: パ (pa)', 'パピプペポ', 'dakuten'),
	K('kya', 'Combinados: キャ, ギャ', 'キャキュキョギャギュギョ', 'yoon'),
	K('sha', 'Combinados: シャ, ジャ', 'シャシュショジャジュジョ', 'yoon'),
	K('cha', 'Combinados: チャ, ニャ', 'チャチュチョニャニュニョ', 'yoon'),
	K('hya', 'Combinados: ヒャ, ビャ, ピャ', 'ヒャヒュヒョビャビュビョピャピュピョ', 'yoon'),
	K('mya', 'Combinados: ミャ, リャ', 'ミャミュミョリャリュリョ', 'yoon'),
	K('tsu', 'La ッ pequeña y la raya ー', 'ッー', 'special'),
	K('fa', 'Extendidos: ファ, ティ, ウィ…', 'ファフィフェフォティディウィウェウォ', 'extended'),
	K('she', 'Extendidos: シェ, チェ, ジェ, ヴ', 'シェチェジェヴトゥ', 'extended')
];

/** Romaji de los que wanakana no da como queremos o que tienen sílabas extranjeras. */
const ROMAJI_OVERRIDES: Record<string, string> = {
	を: 'wo',
	ヲ: 'wo',
	ぢ: 'ji',
	ヂ: 'ji',
	づ: 'zu',
	ヅ: 'zu',
	っ: 'tsu',
	ッ: 'tsu',
	ー: '-',
	ファ: 'fa',
	フィ: 'fi',
	フェ: 'fe',
	フォ: 'fo',
	ティ: 'ti',
	ディ: 'di',
	ウィ: 'wi',
	ウェ: 'we',
	ウォ: 'wo',
	シェ: 'she',
	チェ: 'che',
	ジェ: 'je',
	ヴ: 'vu',
	トゥ: 'tu'
};

/** Mnemotecnias de los kana básicos (forma + sonido, en español). */
const MNEMONICS: Record<string, string> = {
	// Hiragana
	あ: 'Un pirata atraviesa una «A» cursiva con su espada (la cruz) y grita «¡Aaah!».',
	い: 'Dos palitos de incienso juntos: «i» de incienso.',
	う: 'Una boca de lado con un pelito encima que sopla «uuu».',
	え: 'Un pájaro exótico con cresta (el trazo de arriba) que te llama: «¡eh!».',
	お: 'Una «o» con un poste y una gota: alguien se asombra al ver una gota caer, «¡oh!».',
	か: 'Un karateka da una patada (el trazo con gancho) y suelta su grito «¡ka!» (la rayita).',
	き: 'Una llave antigua con dos dientes (key en inglés suena «ki»).',
	く: 'El pico abierto de un cuco: «¡cu-cú!».',
	け: 'Parece una «k» mal escrita junto a un palo: «ke» de queso.',
	こ: 'Dos koalas dormidos en dos ramas paralelas: «ko».',
	さ: 'Un samurái encorvado: la cruz es su espada y abajo, su espalda curvada como una «c».',
	し: 'Un anzuelo: «¡sí!», picó el pez.',
	す: 'Un columpio con un nudo en la cuerda: «suuu», se balancea.',
	せ: 'Los dientes de un serrucho (se-rrucho) con un mango que baja.',
	そ: 'Una soga en zigzag colgando: «so» de soga.',
	た: 'Una «t» y un «a» mal escrito juntos: た = t + a.',
	ち: 'Parece un 5: un chico que saca barriga y se ríe «chi-chi».',
	つ: 'Una ola que rompe: «tsu» de tsunami.',
	て: 'Una mano tendida que te ofrece algo: «te» lo doy.',
	と: 'Un dedo del pie con una astilla clavada: «to» de tobillo.',
	な: 'Una cruz y alguien arrodillado rezando con un rizo: «na» de nada, ¡que no le escuchan!',
	に: 'Un niño (ni) de pie junto a dos peldaños.',
	ぬ: 'Fideos con un par de palillos; termina en rizo, como un fideo enroscado: «nu».',
	ね: 'Un gato (neko) sentado con la cola enroscada: «ne».',
	の: 'Una señal de prohibido trazada de un tirón: «¡no!».',
	は: 'Dos personas: una de pie y otra que se ríe a carcajadas, «¡ha!». Como partícula se lee «wa».',
	ひ: 'Una boca sonriente que se ríe por lo bajo: «¡hi, hi!».',
	ふ: 'El monte Fuji entre nubecillas: «fu».',
	へ: 'Una montañita: «he», ¡eh, mira qué cuesta! (en katakana es igual).',
	ほ: 'Como は pero con un techo: un hotel (ho) con su tejado.',
	ま: 'Un mástil con dos velas y un nudo abajo: mamá tiende la ropa.',
	み: 'Un 21 en cursiva: «mi» cumpleaños número 21.',
	む: 'Una vaca vista de lado con su cola y una oreja (el punto): «muuu».',
	め: 'Un ojo (en japonés «me» es ojo); a diferencia de ぬ, no termina en rizo.',
	も: 'Un anzuelo con dos cebos: más peces, «mo» (en japonés も es «también»).',
	や: 'Un yak con sus cuernos: «ya».',
	ゆ: 'Un pez nadando dentro de una «U»: «yu» suena como la letra U en inglés.',
	よ: 'Un yoyó colgando de un dedo: «yo».',
	ら: 'Una rata con la cabeza levantada y orejas: «ra».',
	り: 'Dos ríos que caen en paralelo: «ri» de río.',
	る: 'Una ruleta que termina en lazo: «ru» (ろ no tiene lazo).',
	れ: 'Un rey arrodillado con su bastón; la cola sale hacia fuera: «re».',
	ろ: 'Un 3 roto, sin lazo al final: «ro» de roto.',
	わ: 'Un perro sentado que ladra «¡wa, wa!» (guau); la cola se curva hacia dentro.',
	を: 'Alguien que corre con un dorsal; hoy solo es la partícula de objeto y se pronuncia «o».',
	ん: 'Una «n» escrita a mano: el único kana que es solo una consonante.',
	// Katakana
	ア: 'Un hacha con su mango largo: «a» de hacha.',
	イ: 'Una persona de perfil, inclinada: «i» de individuo (イ es medio 人).',
	ウ: 'Como う pero con tejado: una «U» con sombrero.',
	エ: 'Una viga de acero en forma de I: «e» de edificio.',
	オ: 'Un hombre con un brazo en alto y la boca abierta: «¡oh!».',
	カ: 'Casi igual que か, sin la rayita: un karateka que ya no grita.',
	キ: 'La misma llave que き, pero con los dientes rectos: «ki».',
	ク: 'El pico de un cuco con tejado, más cerrado que く: «ku».',
	ケ: 'Una «K» medio caída: «ke». El último trazo baja recto, a diferencia de ク.',
	コ: 'La esquina de un cofre: «ko». En ユ la raya de abajo sobresale.',
	サ: 'Un saco colgado de dos palos: «sa».',
	シ: 'Una cara sonriente con los ojos de lado: «shi». El trazo largo sube de abajo hacia arriba; en ツ cae desde arriba.',
	ス: 'Un surfista sobre su tabla: «su».',
	セ: 'Como せ con un trazo menos: un sello estampado, «se».',
	ソ: 'Un chorro que cae desde arriba: «so» de soplar hacia abajo. En ン el trazo sube.',
	タ: 'Como ク con una raya dentro: un taco doblado con relleno, «ta».',
	チ: 'Un chico con los brazos abiertos (parece el kanji 千 «mil»): «chi».',
	ツ: 'Dos gotas en fila arriba y una ola que cae: «tsu» de tsunami. En シ las gotas van una sobre otra.',
	テ: 'Como て con un techo: «te» de techo.',
	ト: 'Un tótem con una sola rama: «to».',
	ナ: 'Una navaja clavada en cruz: «na». En メ es una X.',
	ニ: 'Dos niños acostados: como に sin el palo, «ni».',
	ヌ: 'Unos palillos cruzados sobre los fideos: «nu». En フ no hay cruce.',
	ネ: 'Un poste con su cartel: «ne» de negocio.',
	ノ: 'Un tachón de un solo trazo: «¡no!».',
	ハ: 'Dos trazos que se separan, como el kanji 八 «ocho»: «ha» de hacha que parte en dos.',
	ヒ: 'Una cuchara (como 匕): «hi».',
	フ: 'Un gancho como el de ふ: «fu» de fular colgado.',
	ヘ: 'La misma montañita que へ: «he».',
	ホ: 'Un árbol con dos raíces (como 木): «ho» de hoja.',
	マ: 'Una mano que señala con el dedo corto hacia dentro: «ma».',
	ミ: 'Tres rayas inclinadas: «mi-mi-mi», como el kanji 三.',
	ム: 'Un brazo flexionado que saca músculo: «mu».',
	メ: 'Una X que marca la meta: «me».',
	モ: 'Como も sin el gancho: «mo».',
	ヤ: 'El yak de や con un cuerno menos: «ya».',
	ユ: 'Un yugo: como コ pero la raya de abajo sobresale, «yu».',
	ヨ: 'Un tridente tumbado con tres dientes: «yo».',
	ラ: 'Un ramo con una raya encima: «ra».',
	リ: 'Los mismos dos ríos que り: «ri».',
	ル: 'Dos piernas abiertas, una con bota: «ru» de ruta.',
	レ: 'Una regla en forma de L: «re».',
	ロ: 'Un cuadrado, como el kanji 口 «boca»: «ro» de roca.',
	ワ: 'Como ウ sin el punto de arriba: «wa».',
	ヲ: 'Casi no se usa: la partícula «o», en carteles y videojuegos antiguos.',
	ン: 'Un trazo corto y otro que sube desde abajo: «n». En ソ el largo cae desde arriba.'
};

const EXAMPLES: Record<string, { word: string; es: string }> = {
	あ: { word: 'あめ', es: 'lluvia' },
	い: { word: 'いぬ', es: 'perro' },
	う: { word: 'うみ', es: 'mar' },
	え: { word: 'えき', es: 'estación' },
	お: { word: 'おかね', es: 'dinero' },
	か: { word: 'かさ', es: 'paraguas' },
	き: { word: 'きた', es: 'norte' },
	く: { word: 'くち', es: 'boca' },
	け: { word: 'いけ', es: 'estanque' },
	こ: { word: 'ここ', es: 'aquí' },
	さ: { word: 'さかな', es: 'pez' },
	し: { word: 'しお', es: 'sal' },
	す: { word: 'すし', es: 'sushi' },
	せ: { word: 'せかい', es: 'mundo' },
	そ: { word: 'そら', es: 'cielo' },
	た: { word: 'たこ', es: 'pulpo' },
	ち: { word: 'ちず', es: 'mapa' },
	つ: { word: 'つき', es: 'luna' },
	て: { word: 'て', es: 'mano' },
	と: { word: 'とり', es: 'pájaro' },
	な: { word: 'なつ', es: 'verano' },
	に: { word: 'にく', es: 'carne' },
	ぬ: { word: 'ぬの', es: 'tela' },
	ね: { word: 'ねこ', es: 'gato' },
	の: { word: 'のり', es: 'alga nori' },
	は: { word: 'はな', es: 'flor' },
	ひ: { word: 'ひと', es: 'persona' },
	ふ: { word: 'ふね', es: 'barco' },
	へ: { word: 'へや', es: 'habitación' },
	ほ: { word: 'ほし', es: 'estrella' },
	ま: { word: 'まど', es: 'ventana' },
	み: { word: 'みみ', es: 'oreja' },
	む: { word: 'むし', es: 'insecto' },
	め: { word: 'め', es: 'ojo' },
	も: { word: 'もり', es: 'bosque' },
	や: { word: 'やま', es: 'montaña' },
	ゆ: { word: 'ゆき', es: 'nieve' },
	よ: { word: 'よる', es: 'noche' },
	ら: { word: 'さくら', es: 'cerezo' },
	り: { word: 'りんご', es: 'manzana' },
	る: { word: 'くるま', es: 'coche' },
	れ: { word: 'れきし', es: 'historia' },
	ろ: { word: 'いろ', es: 'color' },
	わ: { word: 'わたし', es: 'yo' },
	を: { word: 'ほんをよむ', es: 'leer un libro (を marca lo que se lee)' },
	ん: { word: 'ほん', es: 'libro' },
	が: { word: 'がいこく', es: 'el extranjero' },
	ぎ: { word: 'ぎん', es: 'plata' },
	ぐ: { word: 'かぐ', es: 'muebles' },
	げ: { word: 'げんき', es: 'con energía' },
	ご: { word: 'ごはん', es: 'arroz, comida' },
	ざ: { word: 'ざぶとん', es: 'cojín' },
	じ: { word: 'じかん', es: 'tiempo' },
	ず: { word: 'みず', es: 'agua' },
	ぜ: { word: 'かぜ', es: 'viento' },
	ぞ: { word: 'ぞう', es: 'elefante' },
	だ: { word: 'だれ', es: '¿quién?' },
	ぢ: { word: 'はなぢ', es: 'sangre de nariz' },
	づ: { word: 'つづく', es: 'continuar' },
	で: { word: 'でんわ', es: 'teléfono' },
	ど: { word: 'どこ', es: '¿dónde?' },
	ば: { word: 'ばら', es: 'rosa' },
	び: { word: 'えび', es: 'gamba' },
	ぶ: { word: 'ぶた', es: 'cerdo' },
	べ: { word: 'たべもの', es: 'comida' },
	ぼ: { word: 'ぼうし', es: 'sombrero' },
	ぱ: { word: 'かんぱい', es: '¡salud! (brindis)' },
	ぴ: { word: 'えんぴつ', es: 'lápiz' },
	ぷ: { word: 'てんぷら', es: 'tempura' },
	ぺ: { word: 'ぺらぺら', es: 'con fluidez' },
	ぽ: { word: 'さんぽ', es: 'paseo' },
	きゃ: { word: 'きゃく', es: 'cliente' },
	きゅ: { word: 'きゅう', es: 'nueve' },
	きょ: { word: 'きょう', es: 'hoy' },
	ぎゃ: { word: 'ぎゃく', es: 'al revés' },
	ぎゅ: { word: 'ぎゅうにく', es: 'carne de res' },
	ぎょ: { word: 'きんぎょ', es: 'pez de colores' },
	しゃ: { word: 'しゃしん', es: 'foto' },
	しゅ: { word: 'しゅみ', es: 'afición' },
	しょ: { word: 'しょうゆ', es: 'salsa de soja' },
	じゃ: { word: 'じゃま', es: 'estorbo' },
	じゅ: { word: 'じゅぎょう', es: 'clase' },
	じょ: { word: 'じょうず', es: 'hábil' },
	ちゃ: { word: 'おちゃ', es: 'té' },
	ちゅ: { word: 'ちゅうしゃ', es: 'inyección' },
	ちょ: { word: 'ちょきん', es: 'ahorro' },
	にゃ: { word: 'こんにゃく', es: 'konjac' },
	にゅ: { word: 'ぎゅうにゅう', es: 'leche' },
	ひゃ: { word: 'ひゃく', es: 'cien' },
	ひょ: { word: 'ひょう', es: 'tabla; granizo' },
	びゃ: { word: 'さんびゃく', es: 'trescientos' },
	びょ: { word: 'びょういん', es: 'hospital' },
	ぴょ: { word: 'ぴょんぴょん', es: 'dando saltitos' },
	みゃ: { word: 'みゃく', es: 'pulso' },
	みょ: { word: 'みょうじ', es: 'apellido' },
	りゃ: { word: 'りゃくご', es: 'abreviatura' },
	りゅ: { word: 'りゅう', es: 'dragón' },
	りょ: { word: 'りょこう', es: 'viaje' },
	ア: { word: 'アイス', es: 'helado' },
	イ: { word: 'イス', es: 'silla' },
	ウ: { word: 'ウニ', es: 'erizo de mar' },
	エ: { word: 'エアコン', es: 'aire acondicionado' },
	オ: { word: 'オムレツ', es: 'tortilla francesa' },
	カ: { word: 'カメラ', es: 'cámara' },
	キ: { word: 'キス', es: 'beso' },
	ク: { word: 'クラス', es: 'clase' },
	ケ: { word: 'ケア', es: 'cuidado' },
	コ: { word: 'ココア', es: 'cacao' },
	サ: { word: 'サラダ', es: 'ensalada' },
	シ: { word: 'シネマ', es: 'cine' },
	ス: { word: 'スイス', es: 'Suiza' },
	セ: { word: 'セロリ', es: 'apio' },
	ソ: { word: 'ソウル', es: 'Seúl' },
	タ: { word: 'タオル', es: 'toalla' },
	チ: { word: 'チキン', es: 'pollo frito' },
	ツ: { word: 'ツナ', es: 'atún' },
	テ: { word: 'テニス', es: 'tenis' },
	ト: { word: 'トマト', es: 'tomate' },
	ナ: { word: 'ナイフ', es: 'cuchillo' },
	ニ: { word: 'アニメ', es: 'anime' },
	ヌ: { word: 'カヌー', es: 'canoa' },
	ネ: { word: 'ネクタイ', es: 'corbata' },
	ノ: { word: 'ピアノ', es: 'piano' },
	ハ: { word: 'ハム', es: 'jamón' },
	ヒ: { word: 'ヒント', es: 'pista' },
	フ: { word: 'フランス', es: 'Francia' },
	ヘ: { word: 'ヘア', es: 'pelo, peinado' },
	ホ: { word: 'ホテル', es: 'hotel' },
	マ: { word: 'マスク', es: 'mascarilla' },
	ミ: { word: 'ミルク', es: 'leche' },
	ム: { word: 'アルバム', es: 'álbum' },
	メ: { word: 'メモ', es: 'nota' },
	モ: { word: 'モデル', es: 'modelo' },
	ヤ: { word: 'タイヤ', es: 'neumático' },
	ユ: { word: 'ユーロ', es: 'euro' },
	ヨ: { word: 'ヨガ', es: 'yoga' },
	ラ: { word: 'ラジオ', es: 'radio' },
	リ: { word: 'リモコン', es: 'mando a distancia' },
	ル: { word: 'ルビ', es: 'furigana (rubí)' },
	レ: { word: 'レモン', es: 'limón' },
	ロ: { word: 'ロシア', es: 'Rusia' },
	ワ: { word: 'ワイン', es: 'vino' },
	ン: { word: 'パン', es: 'pan' },
	ガ: { word: 'ガム', es: 'chicle' },
	ギ: { word: 'ギター', es: 'guitarra' },
	グ: { word: 'グラス', es: 'copa, vaso' },
	ゲ: { word: 'ゲーム', es: 'videojuego' },
	ゴ: { word: 'ゴルフ', es: 'golf' },
	ザ: { word: 'ピザ', es: 'pizza' },
	ジ: { word: 'ラジオ', es: 'radio' },
	ズ: { word: 'チーズ', es: 'queso' },
	ゼ: { word: 'ゼロ', es: 'cero' },
	ゾ: { word: 'ゾンビ', es: 'zombi' },
	ダ: { word: 'サラダ', es: 'ensalada' },
	デ: { word: 'デザート', es: 'postre' },
	ド: { word: 'ドア', es: 'puerta' },
	バ: { word: 'バス', es: 'autobús' },
	ビ: { word: 'ビル', es: 'edificio' },
	ブ: { word: 'ブラシ', es: 'cepillo' },
	ベ: { word: 'ベル', es: 'timbre' },
	ボ: { word: 'ボタン', es: 'botón' },
	パ: { word: 'パン', es: 'pan' },
	ピ: { word: 'ピアノ', es: 'piano' },
	プ: { word: 'プール', es: 'piscina' },
	ペ: { word: 'ペン', es: 'bolígrafo' },
	ポ: { word: 'ポスト', es: 'buzón' },
	キャ: { word: 'キャンプ', es: 'acampada' },
	キュ: { word: 'キューバ', es: 'Cuba' },
	ギャ: { word: 'ギャグ', es: 'chiste' },
	シャ: { word: 'シャツ', es: 'camisa' },
	シュ: { word: 'シュート', es: 'tiro (deportes)' },
	ショ: { word: 'ショー', es: 'espectáculo' },
	ジャ: { word: 'ジャム', es: 'mermelada' },
	ジュ: { word: 'ジュース', es: 'zumo' },
	ジョ: { word: 'ジョギング', es: 'footing' },
	チャ: { word: 'チャンス', es: 'oportunidad' },
	チョ: { word: 'チョコ', es: 'chocolate' },
	ニュ: { word: 'ニュース', es: 'noticias' },
	ヒュ: { word: 'ヒューズ', es: 'fusible' },
	ビュ: { word: 'ビュッフェ', es: 'bufé' },
	リュ: { word: 'リュック', es: 'mochila' },
	ッ: { word: 'サッカー', es: 'fútbol' },
	ー: { word: 'コーヒー', es: 'café' },
	ファ: { word: 'ファン', es: 'fan, aficionado' },
	フィ: { word: 'フィルム', es: 'película (de fotos)' },
	フェ: { word: 'カフェ', es: 'cafetería' },
	フォ: { word: 'フォーク', es: 'tenedor' },
	ティ: { word: 'パーティー', es: 'fiesta' },
	ディ: { word: 'ディスク', es: 'disco' },
	ウィ: { word: 'ウィンク', es: 'guiño' },
	ウェ: { word: 'ウェブ', es: 'web' },
	ウォ: { word: 'ウォッカ', es: 'vodka' },
	シェ: { word: 'シェフ', es: 'chef' },
	チェ: { word: 'チェス', es: 'ajedrez' },
	ジェ: { word: 'ジェット', es: 'jet' },
	ヴ: { word: 'ヴァイオリン', es: 'violín (también バイオリン)' },
	トゥ: { word: 'タトゥー', es: 'tatuaje' }
};

/** Palabras para practicar っ/ッ y ー (su «respuesta» es el romaji de la palabra). */
export const SPECIAL_WORDS: Record<string, { word: string; es: string }[]> = {
	っ: [
		{ word: 'きって', es: 'sello' },
		{ word: 'がっこう', es: 'escuela' },
		{ word: 'ざっし', es: 'revista' },
		{ word: 'いっぱい', es: 'lleno' }
	],
	ッ: [
		{ word: 'サッカー', es: 'fútbol' },
		{ word: 'ベッド', es: 'cama' },
		{ word: 'ポケット', es: 'bolsillo' }
	],
	ー: [
		{ word: 'コーヒー', es: 'café' },
		{ word: 'ケーキ', es: 'pastel' },
		{ word: 'ゲーム', es: 'videojuego' },
		{ word: 'ノート', es: 'cuaderno' }
	]
};

/** Pares parecidos y cómo distinguirlos. Se muestran en la lección del segundo y al fallar. */
export const KANA_SIMILAR: { a: string; b: string; tip: string }[] = [
	{ a: 'シ', b: 'ツ', tip: 'シ: las gotas van una sobre otra y el trazo largo sube desde abajo. ツ: las gotas van en fila arriba y el largo cae desde arriba.' },
	{ a: 'ソ', b: 'ン', tip: 'ソ: el trazo largo cae desde arriba. ン: sube desde abajo (como シ).' },
	{ a: 'ク', b: 'ケ', tip: 'ク tiene dos trazos y queda cerrada; ケ tiene tres y el último baja recto.' },
	{ a: 'ク', b: 'タ', tip: 'タ es ク con una raya dentro.' },
	{ a: 'ナ', b: 'メ', tip: 'ナ es una cruz con el palo recto; メ es una X.' },
	{ a: 'ワ', b: 'ウ', tip: 'ウ lleva un punto arriba; ワ no.' },
	{ a: 'フ', b: 'ヌ', tip: 'ヌ tiene un trazo que cruza; フ no.' },
	{ a: 'コ', b: 'ユ', tip: 'En ユ la raya de abajo sobresale a la derecha; コ es una esquina limpia.' },
	{ a: 'ア', b: 'マ', tip: 'ア baja con una pata larga; マ termina con un trazo corto hacia dentro.' },
	{ a: 'ぬ', b: 'め', tip: 'ぬ termina en un rizo; め no.' },
	{ a: 'ね', b: 'れ', tip: 'ね termina en rizo; れ termina con la cola abierta hacia fuera.' },
	{ a: 'わ', b: 'れ', tip: 'わ termina en una curva hacia dentro; れ, con la cola hacia fuera.' },
	{ a: 'ね', b: 'わ', tip: 'ね termina en rizo; わ, en una curva sin cerrar.' },
	{ a: 'さ', b: 'ち', tip: 'さ termina abajo como una «c» (abierta a la derecha); ち, como un 5 (abierta a la izquierda).' },
	{ a: 'る', b: 'ろ', tip: 'る termina en un lazo; ろ no.' },
	{ a: 'は', b: 'ほ', tip: 'ほ tiene una raya más arriba (un techo); は no.' },
	{ a: 'き', b: 'さ', tip: 'き tiene dos rayas horizontales; さ, una.' },
	{ a: 'あ', b: 'お', tip: 'En あ la cruz atraviesa el lazo; en お el palo queda aparte y lleva un punto.' },
	{ a: 'い', b: 'り', tip: 'い: dos trazos casi iguales; り: el de la derecha baja mucho más.' },
	{ a: 'う', b: 'ら', tip: 'う tiene un trazo arriba plano; ら, un punto inclinado y una curva más abierta.' },
	{ a: 'け', b: 'は', tip: 'は tiene un lazo abajo; け no.' },
	{ a: 'ち', b: 'ら', tip: 'ち tiene una raya que cruza arriba; ら, solo un punto.' }
];

const ALL_ROW_CHARS = KANA_ROWS.flatMap((r) => r.chars);
export const COURSE_KANA: string[] = ALL_ROW_CHARS;
const ROW_OF = new Map(KANA_ROWS.flatMap((r) => r.chars.map((c) => [c, r] as const)));
export const rowOf = (key: string) => ROW_OF.get(key) ?? null;

/** Los 46 hiragana básicos: hasta tenerlos estudiados, las lecciones de kanji y la gramática esperan. */
export const HIRAGANA_CORE = KANA_ROWS.filter((r) => r.script === 'hiragana' && r.group === 'basic').flatMap((r) => r.chars);

export const isSpecialKana = (key: string) => key in SPECIAL_WORDS;

/** Romaji principal de un kana del curso (o de cualquier cadena de kana). */
export function kanaKeyRomaji(key: string): string {
	return ROMAJI_OVERRIDES[key] ?? toRomaji(key);
}

/** Ficha de un kana del curso (sin la palabra de los especiales, que se elige al preguntar). */
export function kanaEntry(key: string): KanaEntry {
	return { romaji: kanaKeyRomaji(key), mnemonic: MNEMONICS[key], example: EXAMPLES[key] ?? SPECIAL_WORDS[key]?.[0] };
}

/** Cómo se forma un kana derivado («か + ゛», «き + ゃ»). */
export function kanaFormation(key: string): string | null {
	const base = key.normalize('NFD');
	if (base.length === 2 && (base[1] === '゙' || base[1] === '゚')) return `${base[0]} + ${base[1] === '゙' ? '゛' : '゜'}`;
	if ([...key].length === 2) return `${[...key][0]} + ${[...key][1]} pequeña`;
	return null;
}

/** Parecidos de un kana con su consejo. */
export function kanaSimilar(key: string): { char: string; tip: string }[] {
	return KANA_SIMILAR.filter((p) => p.a === key || p.b === key).map((p) => ({ char: p.a === key ? p.b : p.a, tip: p.tip }));
}
