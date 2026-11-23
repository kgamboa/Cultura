import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api } from "./api";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";

const FIELDS = actionFields<typeof Actions>();

/* ============ Utilidades: semilla por iniciales ============ */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j] as T; a[j] = tmp as T;
  }
  return a;
}
const normInitials = (s: string) => s.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, "").slice(0, 8);

/* ============ Preguntas base de teoría ============ */
type BaseQ = { id: string; topic: string; q: string; options: string[]; correct: number; expl: string };
const BASE_QUESTIONS: BaseQ[] = [
  { id: "celda", topic: "Celdas y rangos", q: "¿Qué es una celda en Excel?", options: ["La intersección de una fila y una columna, donde escribes un dato", "Una fila completa de la hoja", "Un gráfico dentro de la hoja", "El nombre del archivo"], correct: 0, expl: "La celda es el cruce de una fila y una columna. Ahí va cada dato." },
  { id: "fila-col", topic: "Celdas y rangos", q: "¿Cómo se identifican las filas y las columnas?", options: ["Filas con letras y columnas con números", "Filas con números y columnas con letras", "Ambas con números", "Ambas con colores"], correct: 1, expl: "Las columnas van con letras (A, B, C…) y las filas con números (1, 2, 3…)." },
  { id: "b3", topic: "Celdas y rangos", q: "La referencia B3 significa…", options: ["Fila B, columna 3", "Columna B, fila 3", "La tercera hoja del libro", "El rango de B hasta 3"], correct: 1, expl: "Primero va la columna (letra B) y luego la fila (número 3): celda B3." },
  { id: "rango", topic: "Celdas y rangos", q: "¿Qué es un rango en Excel?", options: ["Un grupo de celdas seleccionadas, como A1:C5", "Una sola celda con formato", "Un tipo de gráfico", "Una fórmula especial"], correct: 0, expl: "Un rango es un conjunto de celdas. Se escribe con la primera y la última celda." },
  { id: "rango-esc", topic: "Celdas y rangos", q: "¿Cómo se escribe el rango que va de A1 hasta C5?", options: ["A1-C5", "A1:C5", "A1;C5", "A1/C5"], correct: 1, expl: "Los rangos se escriben con dos puntos: A1:C5." },
  { id: "colon", topic: "Celdas y rangos", q: "¿Para qué sirve el signo dos puntos ( : ) en Excel?", options: ["Para dividir dos números", "Para indicar un rango: todas las celdas de una a otra, como en =SUMA(A1:A5)", "Para separar celdas sueltas", "Para escribir comentarios"], correct: 1, expl: "El : indica un rango continuo. =SUMA(A1:A5) suma A1, A2, A3, A4 y A5. Igual en =PROMEDIO(B2:B10)." },
  { id: "colon-vs-pyc", topic: "Celdas y rangos", q: "¿Cuál es la diferencia entre : y ; en una fórmula?", options: ["Son lo mismo, se usan igual", ": suma y ; resta", ": indica un rango continuo (A1:A5) y ; separa celdas o valores sueltos (A1;A3;A5)", "; indica un rango y : separa sueltos"], correct: 2, expl: ": = de una celda a otra (rango). ; = celdas sueltas separadas, una por una." },
  { id: "seleccionar", topic: "Celdas y rangos", q: "¿Cómo seleccionas un rango como A1:C5?", options: ["Haces clic en A1 y arrastras hasta C5", "Escribes el rango en cualquier celda", "Solo se puede con el teclado numérico", "No se pueden seleccionar varias celdas"], correct: 0, expl: "Clic en la primera celda y arrastra hasta la última; también puedes escribir A1:C5 en el Cuadro de nombres." },
  { id: "formato", topic: "Formato básico", q: "¿Para qué sirve el formato básico (negrita, color, bordes, formato de número)?", options: ["Para que la tabla se lea mejor y los datos se entiendan", "Para hacer cálculos automáticos", "Para proteger el archivo con contraseña", "Para crear gráficos"], correct: 0, expl: "El formato no calcula: hace la información más clara (títulos en negrita, dinero con $, fechas, etc.)." },
  { id: "suma-sueltas", topic: "SUMA", q: "Quieres sumar solo las celdas A1 y A4 (sueltas, no seguidas). ¿Cuál fórmula es correcta?", options: ["=SUMA(A1:A4)", "=A1+A4", "=PROMEDIO(A1;A4)", "=CONTAR(A1;A4)"], correct: 1, expl: "Para celdas sueltas puedes usar =A1+A4 o =SUMA(A1;A4) con punto y coma. A1:A4 sumaría también A2 y A3." },
  { id: "suma-rango", topic: "SUMA", q: "¿Qué hace la fórmula =SUMA(A1:A5)?", options: ["Suma solo A1 y A5", "Resta A5 menos A1", "Suma todas las celdas de A1 a A5", "Cuenta cuántas celdas hay"], correct: 2, expl: "SUMA con un rango (con :) suma todas las celdas entre la primera y la última." },
  { id: "autosuma", topic: "SUMA", q: "¿Qué hace el botón Autosuma (Σ)?", options: ["Crea un gráfico automático", "Propone y escribe por ti la fórmula SUMA del rango cercano de números", "Ordena los datos de mayor a menor", "Borra las celdas vacías"], correct: 1, expl: "Autosuma detecta los números cercanos y escribe =SUMA(rango) por ti. Solo revisas el rango y das Enter." },
  { id: "prom-sign", topic: "PROMEDIO", q: "¿Qué significa el promedio de un grupo de números?", options: ["El número más grande del grupo", "La suma de todos dividida entre cuántos son: el valor típico o central", "El número que más se repite escrito dos veces", "La resta entre el mayor y el menor"], correct: 1, expl: "Promedio = suma ÷ cantidad. Ej.: (10+20+30) ÷ 3 = 20." },
  { id: "prom-form", topic: "PROMEDIO", q: "¿Qué calcula =PROMEDIO(B2:B10)?", options: ["La suma de B2 a B10", "El promedio de los valores de B2 a B10", "Cuántas celdas hay de B2 a B10", "El valor máximo de B2 a B10"], correct: 1, expl: "PROMEDIO suma el rango y lo divide entre la cantidad de valores, todo en un paso." },
  { id: "max", topic: "MAX, MIN y CONTAR", q: "¿Qué devuelve =MAX(B2:B5)?", options: ["La suma del rango", "El valor más grande del rango", "El valor más chico del rango", "La cantidad de celdas"], correct: 1, expl: "MAX busca el valor mayor. Su pareja MIN busca el menor." },
  { id: "min-contar", topic: "MAX, MIN y CONTAR", q: "¿Qué hace =CONTAR(B2:B5)?", options: ["Suma los números del rango", "Cuenta cuántas celdas del rango tienen números", "Cuenta las letras del rango", "Busca el número menor"], correct: 1, expl: "CONTAR cuenta celdas con números. MIN, en cambio, devuelve el valor más pequeño." },
  { id: "ordenar", topic: "Ordenar y filtrar", q: "¿Para qué sirve Ordenar en Excel?", options: ["Para poner los datos en orden (A-Z, de menor a mayor, por fecha…)", "Para borrar filas repetidas siempre", "Para cambiar el color de las celdas", "Para imprimir la hoja"], correct: 0, expl: "Ordenar acomoda las filas según una columna: alfabético, numérico o por fecha." },
  { id: "filtrar", topic: "Ordenar y filtrar", q: "¿Para qué sirve un Filtro?", options: ["Para mostrar solo las filas que cumplen una condición y ocultar las demás temporalmente", "Para eliminar datos para siempre", "Para sumar una columna", "Para proteger la hoja"], correct: 0, expl: "El filtro no borra nada: solo muestra lo que cumple la condición (ej.: solo 'León')." },
  { id: "grafico", topic: "Gráficos básicos", q: "Quieres comparar las ventas de 4 productos. ¿Qué gráfico básico es el más claro?", options: ["Gráfico de barras o columnas", "Gráfico de líneas de tendencia anual", "Un gráfico circular de 40 partes", "Ningún gráfico sirve para comparar"], correct: 0, expl: "Barras/columnas comparan cantidades entre categorías de un vistazo." },
  { id: "relativa", topic: "Referencias", q: "¿Qué es una referencia relativa, como A1?", options: ["Una referencia que nunca cambia", "La normal: al copiar la fórmula a otra fila, se ajusta sola (A1 pasa a A2, A3…)", "Una referencia con signo de pesos", "Una celda bloqueada con contraseña"], correct: 1, expl: "La referencia relativa se adapta al copiar. Es el comportamiento normal de Excel." },
  { id: "absoluta", topic: "Referencias", q: "¿Qué significa $A$1?", options: ["Que la celda vale dinero", "Una referencia absoluta: columna y fila fijas, no cambian al copiar la fórmula", "Un error de Excel", "Que la celda está en formato moneda"], correct: 1, expl: "El $ fija. $A$1 siempre apunta a A1, copies la fórmula donde la copies." },
  { id: "mixta", topic: "Referencias", q: "¿Qué es una referencia mixta como $A1 o A$1?", options: ["Una fórmula con dos funciones", "Una referencia donde solo una parte está fija: $A1 fija la columna, A$1 fija la fila", "Un rango de dos celdas", "Una celda con texto y número"], correct: 1, expl: "Mixta = mitad fija, mitad libre. El $ va pegado a lo que quieres fijar." },
  { id: "fijar", topic: "Referencias", q: "¿Para qué sirve fijar una celda con $ al copiar una fórmula?", options: ["Para que todas las copias sigan usando esa misma celda (ej.: una tasa o un precio fijo en $E$2)", "Para que la fórmula se vea más profesional", "Para impedir que otros abran el archivo", "Para convertir el número en texto"], correct: 0, expl: "Si una tasa está en E2 y copias la fórmula hacia abajo, sin $ apuntaría a E3, E4… Con $E$2 todas usan la misma tasa." },
  { id: "err-div0", topic: "Errores", q: "Ves el error #¡DIV/0! ¿Qué significa?", options: ["La función está mal escrita", "Estás dividiendo entre cero o entre una celda vacía", "La columna es muy angosta", "La celda fue eliminada"], correct: 1, expl: "#¡DIV/0! = división entre cero. Revisa el divisor: no puede ser 0 ni estar vacío. Ej.: =10/0." },
  { id: "err-valor", topic: "Errores", q: "Ves el error #¡VALOR! ¿Qué lo causa normalmente?", options: ["Dividir entre cero", "Usar un tipo de dato incorrecto: por ejemplo, sumar un texto como si fuera número", "Escribir mal el nombre de la función", "Borrar una celda usada en la fórmula"], correct: 1, expl: "#¡VALOR! aparece cuando Excel espera un número y encuentra texto, ej.: =\"hola\"+5." },
  { id: "err-nombre", topic: "Errores", q: "Ves el error #¿NOMBRE? ¿Qué pasó?", options: ["La columna es muy angosta", "El valor no está disponible", "El nombre de la función está mal escrito (ej.: =SUMMA en vez de =SUMA)", "Dividiste entre cero"], correct: 2, expl: "#¿NOMBRE? = Excel no reconoce lo que escribiste. Casi siempre es una función mal escrita." },
  { id: "err-ref", topic: "Errores", q: "Ves el error #¡REF! ¿Qué significa?", options: ["La fórmula hace referencia a una celda que ya no existe (fue eliminada)", "Falta un dato en la tabla", "La función está mal escrita", "El número no cabe en la columna"], correct: 0, expl: "#¡REF! = referencia inválida. Pasó porque borraste una fila/columna que la fórmula usaba." },
  { id: "err-na", topic: "Errores", q: "¿Qué indica el error #N/A?", options: ["Que dividiste entre cero", "Que un valor no está disponible o no se encontró lo que se buscaba", "Que la columna es angosta", "Que sobra un paréntesis"], correct: 1, expl: "#N/A significa 'no disponible': el dato buscado no está. No es que la fórmula esté rota, falta el dato." },
  { id: "err-numeral", topic: "Errores", q: "Una celda muestra ##### ¿Qué significa y cómo se arregla?", options: ["Es un error grave: hay que borrar la hoja", "La columna es demasiado angosta para mostrar el número o fecha: se arregla ensanchando la columna", "Dividiste entre cero", "La función no existe"], correct: 1, expl: "##### no es un error de cálculo: el dato no cabe. Doble clic en el borde de la columna para ajustarla." },
  { id: "ia-formulas", topic: "IA y Excel", q: "¿Cuál es una buena forma de pedirle a una IA una fórmula de Excel?", options: ["Escribir solo 'hazme una fórmula'", "Explicar qué quieres lograr, dónde están tus datos y un ejemplo: 'En B2:B10 están las calificaciones, quiero el promedio'", "Pedirle que adivine tu tabla sin explicarle nada", "No se le puede pedir fórmulas a una IA"], correct: 1, expl: "Entre más claro el contexto (qué datos, en qué celdas, qué resultado), mejor la fórmula que propone la IA." },
  { id: "ia-limpiar", topic: "IA y Excel", q: "¿Cómo puede ayudarte la IA a limpiar datos en Excel?", options: ["Puede sugerir pasos para quitar duplicados, uniformar nombres y corregir formatos, y explicarte cómo hacerlo", "Borra tu archivo y lo hace de nuevo sola", "No puede ayudar en nada con datos", "Cambia los datos sin que te des cuenta"], correct: 0, expl: "La IA sirve como guía: te dice qué herramientas usar (quitar duplicados, TRIM/ESPACIOS, buscar y reemplazar) y en qué orden." },
  { id: "ia-analizar", topic: "IA y Excel", q: "Le pides a una IA que revise tu tabla y detecte errores. ¿Qué es lo correcto?", options: ["Confiar ciegamente en todo lo que diga", "Usarla como una segunda revisión: puede señalar posibles errores (un total que no cuadra, un dato fuera de rango), pero tú verificas en la hoja", "Borrar todo lo que la IA marque sin revisar", "La IA nunca puede ayudar a revisar"], correct: 1, expl: "La IA puede detectar patrones raros y posibles errores, pero la verificación final siempre es tuya en los datos reales." },
  { id: "ia-sensibles", topic: "IA y Excel", q: "¿Qué NO debes hacer al usar IA con Excel?", options: ["Pedirle que te explique una fórmula", "Subir o pegar datos sensibles: contraseñas, datos bancarios, CURP o información personal de otras personas", "Pedirle ejemplos con datos inventados", "Preguntarle qué significa un error"], correct: 1, expl: "Nunca compartas datos sensibles con una IA. Para practicar o pedir ayuda, usa datos de ejemplo o anonimizados." },
  { id: "ia-verificar", topic: "IA y Excel", q: "La IA te propone una fórmula. ¿Qué debes hacer antes de usarla en tu trabajo?", options: ["Usarla tal cual, la IA nunca se equivoca", "Verificarla: probarla con un ejemplo sencillo donde ya sepas el resultado y revisar que use las celdas correctas", "Cambiarle los signos al azar", "Pagar para que la verifique"], correct: 1, expl: "La IA puede inventar funciones o usar rangos equivocados. Prueba la fórmula con datos donde conozcas la respuesta." },
];

/* ============ Reactivos nuevos de teoría (propuesta del PDF "Arquitectura de Excel") ============ */
const NEW_QUESTIONS: BaseQ[] = [
  { id: "t1-nombres", topic: "Interfaz", q: "¿Qué información muestra el Cuadro de Nombres?", options: ["El resultado de la última fórmula calculada.", "La dirección (referencia) de la celda activa.", "El nombre del archivo.", "La cantidad de hojas que tiene el libro."], correct: 1, expl: "El Cuadro de Nombres muestra la referencia de la celda activa (ej.: B3) y también sirve para ir a una celda escribiendo su dirección." },
  { id: "t2-barra", topic: "Interfaz", q: "Seleccionas una celda que tiene una fórmula y el resultado visible es 93. ¿Qué ves en la barra de fórmulas?", options: ["El número 93.", "La fórmula completa que produce ese resultado.", "El nombre de la hoja.", "Nada, queda vacía."], correct: 1, expl: "La celda muestra el resultado (93), pero la barra de fórmulas muestra la fórmula que lo produce." },
  { id: "t5-comparacion", topic: "Comparación", q: "¿Qué devuelve la fórmula =5>3?", options: ["5", "3", "VERDADERO", "#¡VALOR!"], correct: 2, expl: "Las comparaciones no devuelven un número: devuelven un valor lógico, VERDADERO o FALSO. 5 sí es mayor que 3, así que es VERDADERO." },
  { id: "t6-distinto", topic: "Comparación", q: "¿Qué símbolo se usa para preguntar si dos valores son diferentes?", options: ["=", "<>", ">=", "&"], correct: 1, expl: "El operador <> significa 'distinto de': devuelve VERDADERO cuando los dos valores no son iguales." },
  { id: "t8-concatena", topic: "Concatenación", q: "¿Qué hace el símbolo & cuando se usa entre dos celdas con texto?", options: ["Suma los dos textos.", "Los compara y devuelve VERDADERO o FALSO.", "Une los dos textos en uno solo.", "Borra el texto de la segunda celda."], correct: 2, expl: "El & es el operador de concatenación: pega el contenido de las celdas en un solo texto." },
  { id: "t10-anatomia-nombre", topic: "Anatomía de una función", q: "En la fórmula =PROMEDIO(B2:B13), ¿qué es \"PROMEDIO\"?", options: ["El argumento.", "El iniciador.", "El nombre de la función.", "El rango."], correct: 2, expl: "PROMEDIO es el nombre de la función: la instrucción que se va a aplicar. B2:B13 es el argumento (el rango)." },
  { id: "t11-anatomia-rango", topic: "Anatomía de una función", q: "En la fórmula =PROMEDIO(B2:B13), ¿qué significan los dos puntos entre B2 y B13?", options: ["Que se dividen las dos celdas.", "Que se toman todas las celdas desde B2 hasta B13.", "Que se separan celdas sueltas.", "Que se multiplican las dos celdas."], correct: 1, expl: "Los dos puntos significan 'hasta': el rango completo de B2 hasta B13, incluyendo todo lo de en medio." },
  { id: "t13-corchetes", topic: "Anatomía de una función", q: "Cuando lees la descripción de una función y un dato aparece entre corchetes [ ], ¿qué significa?", options: ["Que ese dato es obligatorio.", "Que ese dato es opcional.", "Que hay un error en la función.", "Que es un rango de celdas."], correct: 1, expl: "En la sintaxis de una función, lo que va entre corchetes [ ] es un argumento opcional: puedes omitirlo." },
  { id: "t14-fx", topic: "Interfaz", q: "¿Para qué sirve el botón \"fx\" que está junto a la barra de fórmulas?", options: ["Para guardar el archivo.", "Para borrar la fórmula de la celda.", "Para buscar e insertar una función cuando no recuerdas su nombre.", "Para poner el texto en negritas."], correct: 2, expl: "El botón fx (Insertar función) abre el asistente con el catálogo de funciones por categorías, para buscar e insertar la que necesitas." },
  { id: "t15-f4", topic: "Referencias", q: "Estás escribiendo una fórmula y quieres que una celda no se mueva al copiarla. ¿Qué tecla agrega los signos de $ a la referencia?", options: ["F2", "F4", "F9", "Ctrl+C"], correct: 1, expl: "Con el cursor sobre la referencia, F4 alterna entre relativa (A1), absoluta ($A$1) y mixtas ($A1, A$1)." },
  { id: "t16-relleno-donde", topic: "Controlador de relleno", q: "¿Dónde está el controlador de relleno (la cruz negra fina)?", options: ["En la esquina superior izquierda de la celda activa.", "En el centro de la celda activa.", "En la esquina inferior derecha de la celda activa.", "Junto al botón \"fx\"."], correct: 2, expl: "El controlador de relleno es el cuadrito de la esquina inferior derecha de la celda activa; al arrastrarlo, Excel continúa la serie o copia la fórmula." },
  { id: "t17-relleno-meses", topic: "Controlador de relleno", q: "Escribes \"Enero\" en una celda y arrastras el controlador de relleno hacia abajo. ¿Qué aparece en las celdas siguientes?", options: ["\"Enero\" repetido en todas.", "Febrero, Marzo, Abril…", "Los números 1, 2, 3…", "Las celdas quedan vacías."], correct: 1, expl: "Excel reconoce las listas conocidas (meses, días) y continúa la serie: Febrero, Marzo, Abril…" },
  { id: "t18-no-combinar", topic: "Ordenar y filtrar", q: "Vas a ordenar y filtrar una lista de datos. ¿Qué conviene evitar?", options: ["Poner encabezados.", "Combinar celdas.", "Usar formato Moneda.", "Escribir los datos en columnas."], correct: 1, expl: "Las celdas combinadas rompen la estructura de la lista: ordenar y filtrar falla o se desacomoda. Mejor dejar cada dato en su celda." },
  { id: "t19-alineacion", topic: "Formato básico", q: "En una tabla, Excel acomoda el texto y los números de forma distinta. ¿Cómo los acomoda por defecto?", options: ["Todo a la izquierda.", "Todo a la derecha.", "El texto a la izquierda y los números a la derecha.", "El texto a la derecha y los números a la izquierda."], correct: 2, expl: "Por defecto el texto se alinea a la izquierda y los números a la derecha. Esa alineación también delata cuando un número quedó guardado como texto." },
  { id: "t20-moneda", topic: "Formato básico", q: "Tienes una columna con precios (500, 20, 45, 150) y quieres que se vean como $500.00, $20.00, etc. ¿Qué formato aplicas?", options: ["Porcentaje", "Fecha", "Moneda", "Texto"], correct: 2, expl: "El formato Moneda muestra el signo $, separadores de miles y dos decimales. El valor no cambia, solo su presentación." },
  { id: "t21-tabla-ctrlt", topic: "Tablas", q: "Seleccionas un rango con datos y presionas Ctrl+T. ¿Qué pasa?", options: ["Se borra el rango.", "Se convierte en una tabla con formato automático y filtros en los encabezados.", "Se copia el rango a otra hoja.", "Se ordenan los datos."], correct: 1, expl: "Ctrl+T crea una Tabla estructurada: formato automático, filtros en los encabezados y fórmulas que se expanden solas a las filas nuevas." },
  { id: "t22-dinamica-que", topic: "Tablas dinámicas", q: "Tienes una lista con miles de filas de ventas y quieres un resumen por categoría sin escribir fórmulas. ¿Qué herramienta usas?", options: ["Una tabla dinámica.", "El controlador de relleno.", "Combinar celdas.", "La barra de fórmulas."], correct: 0, expl: "La tabla dinámica resume miles de filas (sumas, conteos, promedios por grupo) arrastrando campos, sin escribir una sola fórmula." },
  { id: "t23-dinamica-valores", topic: "Tablas dinámicas", q: "En una tabla dinámica, ¿qué hace la zona Valores?", options: ["Filtra los datos.", "Agrupa los datos por mes.", "Hace el cálculo: suma, cuenta o promedia.", "Cambia el color de la tabla."], correct: 2, expl: "Valores es el núcleo matemático de la tabla dinámica: ahí va el campo que se suma, se cuenta o se promedia." },
  { id: "t24-graf-columnas", topic: "Gráficos básicos", q: "Quieres comparar las ventas entre distintas sucursales. ¿Qué tipo de gráfico conviene?", options: ["Circular (pastel)", "De líneas", "De columnas", "De área"], correct: 2, expl: "Para comparar magnitudes entre categorías (sucursales, productos) el gráfico de columnas es el más claro." },
  { id: "t25-graf-lineas", topic: "Gráficos básicos", q: "Quieres mostrar cómo evolucionaron los gastos año con año. ¿Qué tipo de gráfico conviene?", options: ["De columnas", "Circular (pastel)", "De líneas", "De dispersión"], correct: 2, expl: "El gráfico de líneas muestra tendencias a lo largo del tiempo: cómo sube o baja algo periodo a periodo." },
  { id: "t26-graf-circular", topic: "Gráficos básicos", q: "Quieres mostrar cómo se reparte el presupuesto general entre sus partes. ¿Qué tipo de gráfico conviene?", options: ["De líneas", "De columnas", "Circular (pastel)", "De dispersión"], correct: 2, expl: "El gráfico circular (pastel) sirve para partes de un todo: cada rebanada es el porcentaje de una parte." },
  { id: "t27-niveles", topic: "Arquitectura de Excel", q: "Según la arquitectura de Excel, el trabajo tiene 4 niveles: Captura, Lógica, Análisis y Decisión. ¿Qué nivel sigue después de capturar los datos?", options: ["Decisión", "Análisis", "Lógica", "Captura"], correct: 2, expl: "El orden es: 1 Captura (los datos), 2 Lógica (fórmulas y cálculos), 3 Análisis (tablas dinámicas y filtros), 4 Decisión (gráficos y conclusiones)." },
  { id: "t28-manual-vs-funcion", topic: "SUMA", q: "Tienes 20 celdas con números y quieres el total. ¿Qué conviene escribir?", options: ["=A1+A2+…+A20 (las 20 celdas una por una)", "=SUMA(A1:A20)", "=PROMEDIO(A1:A20)", "=CONTAR(A1:A20)"], correct: 1, expl: "La función =SUMA(A1:A20) hace lo mismo que sumar las 20 celdas una por una, pero es más corta, clara y no se rompe si agregas filas." },
  { id: "t29-div0-causa", topic: "Errores", q: "Escribes una división y te sale #¡DIV/0!. ¿Qué pasó?", options: ["Escribiste mal el nombre de la función.", "Dividiste entre cero o entre una celda vacía.", "Borraste una celda que la fórmula necesitaba.", "Multiplicaste texto por un número."], correct: 1, expl: "La causa concreta de #¡DIV/0! es un divisor en cero o una celda vacía usada como divisor: esa división no existe." },
  { id: "t30-valor-causa", topic: "Errores", q: "Intentas multiplicar el contenido de una celda con texto por un número y te sale #¡VALOR!. ¿Qué significa?", options: ["Que dividiste entre cero.", "Que la operación no se puede hacer con ese tipo de dato.", "Que borraste una celda.", "Que la función está mal escrita."], correct: 1, expl: "#¡VALOR! significa que el tipo de dato no sirve para esa operación: no se puede multiplicar un texto por un número." },
  /* Banco del maestro: Office e IA (la pregunta de "qué es una celda" ya existe en el banco base y no se duplica) */
  { id: "b1-word", topic: "Office", q: "Una estudiante necesita redactar un reporte escolar formal que incluya títulos estructurados, imágenes y tablas organizadas. ¿Qué herramienta de productividad es la más adecuada para realizar esta tarea?", options: ["Hoja de cálculo.", "Editor de audio.", "Procesador de texto (Microsoft Word).", "Navegador web."], correct: 2, expl: "El procesador de textos es la herramienta diseñada para la creación, maquetación y edición de documentos escritos estructurados con texto, estilos, tablas e ilustraciones." },
  { id: "b1-cinta", topic: "Office", q: "Dentro del entorno de trabajo de Microsoft Word, ¿qué sección de la interfaz agrupa las herramientas organizadas en pestañas y controles para dar formato, insertar elementos y configurar el documento?", options: ["Barra de desplazamiento.", "Cinta de opciones.", "Barra de estado.", "Control deslizante de zoom."], correct: 1, expl: "La cinta de opciones estructura las pestañas principales (Inicio, Insertar, Disposición, etc.) y los grupos de comandos como Fuente y Párrafo." },
  { id: "b1-hojas-proposito", topic: "Office", q: "¿Cuál es el propósito principal y la mayor ventaja de utilizar hojas de cálculo en proyectos académicos y laborales?", options: ["Editar y renderizar videos de alta definición.", "Diseñar videojuegos en 3D.", "Organizar, calcular y analizar datos numéricos mediante fórmulas.", "Administrar perfiles de redes sociales."], correct: 2, expl: "Las hojas de cálculo están optimizadas para la gestión, el procesamiento matemático mediante fórmulas y el análisis estructurado de datos numéricos." },
  { id: "b1-powerpoint", topic: "Office", q: "¿Qué aplicación digital es la más conveniente cuando el objetivo principal es exponer información de forma visual, dinámica y estructurada ante un grupo o audiencia?", options: ["Microsoft PowerPoint.", "Bloc de notas.", "Base de datos relacional.", "Paint."], correct: 0, expl: "PowerPoint es la herramienta idónea para la comunicación visual y exposiciones grupales mediante diapositivas con apoyo multimedia." },
  { id: "b1-presentacion", topic: "Office", q: "Para lograr una presentación electrónica eficaz y evitar la saturación de la audiencia, ¿cuál de las siguientes prácticas de diseño es la más recomendada?", options: ["Llenar cada diapositiva con párrafos densos de texto plano.", "Escribir todo el contenido en letras mayúsculas continuas.", "Cambiar aleatoriamente los tipos y colores de letra en cada lámina.", "Utilizar títulos claros, síntesis de ideas y elementos visuales o multimedia de apoyo."], correct: 3, expl: "Una presentación adecuada busca síntesis, títulos claros y recursos visuales o multimedia que faciliten la comprensión sin sobrecargar al lector." },
  { id: "b1-ia-riesgo", topic: "IA y Excel", q: "En el contexto de la ciudadanía digital y las tecnologías emergentes, ¿cuál de los siguientes casos representa un riesgo ético significativo en el uso de la Inteligencia Artificial (IA)?", options: ["La difusión de desinformación mediante contenido falso o imágenes manipuladas (Deepfakes).", "El uso de fórmulas automatizadas para calcular promedios.", "La inserción de animaciones y transiciones en diapositivas.", "La edición colaborativa simultánea de un archivo en la nube."], correct: 0, expl: "La generación y propagación de desinformación, manipulación de identidad y contenido engañoso constituyen riesgos éticos centrales en la regulación y uso de la IA." },
  { id: "b1-nube", topic: "Office", q: "¿Qué ventaja fundamental aportan las herramientas de productividad basadas en la nube al realizar proyectos en equipo?", options: ["Evitan que más de una persona tenga acceso al archivo.", "Permiten la colaboración y edición simultánea en tiempo real desde distintas ubicaciones.", "Eliminan por completo la necesidad de contar con conexión a internet.", "Bloquean el uso de contraseñas de seguridad."], correct: 1, expl: "El entorno en la nube facilita el trabajo colaborativo en tiempo real, optimizando el tiempo y evitando la dispersión de versiones de un mismo archivo." },
  /* Banco del maestro: Algoritmos */
  { id: "b2-definicion", topic: "Algoritmos", q: "¿Qué es un algoritmo en informática y en la vida diaria?", options: ["Un componente físico dentro del procesador.", "Una secuencia ordenada y finita de pasos para resolver un problema o realizar una tarea.", "Un tipo de cable para conectar la computadora a internet.", "Una aplicación exclusiva para navegar en redes sociales."], correct: 1, expl: "Un algoritmo es simplemente una serie de instrucciones lógicas paso a paso que tienen un inicio y un fin para cumplir un objetivo." },
  { id: "b2-estructura", topic: "Algoritmos", q: "¿Cuáles son las tres partes fundamentales que componen la estructura de cualquier algoritmo?", options: ["Pantalla, teclado y ratón.", "Entrada, proceso y salida.", "Pregunta, respuesta y duda.", "Descarga, instalación y borrado."], correct: 1, expl: "Todo algoritmo recibe datos iniciales (entrada), realiza operaciones o transformaciones con ellos (proceso) y muestra el resultado final (salida)." },
  { id: "b2-finito", topic: "Algoritmos", q: "¿Qué significa que un algoritmo debe ser \"finito\"?", options: ["Que está escrito con letras muy delgadas.", "Que puede repetirse eternamente sin detenerse.", "Que debe tener un número determinado de pasos y un final definido.", "Que solo funciona en teléfonos celulares."], correct: 2, expl: "La finitud garantiza que el algoritmo termine en algún momento y no se quede atrapado en una ejecución interminable." },
  { id: "b2-cualitativo", topic: "Algoritmos", q: "Si sigues los pasos de una receta de cocina para hornear un pastel, ¿qué tipo de algoritmo estás utilizando?", options: ["Algoritmo binario.", "Algoritmo cualitativo.", "Algoritmo cuantitativo.", "Algoritmo de circuito cerrado."], correct: 1, expl: "Los algoritmos cualitativos describen acciones usando palabras e instrucciones verbales simples, sin depender de fórmulas matemáticas o cálculos numéricos." },
  { id: "b2-variable", topic: "Algoritmos", q: "En programación y algoritmos, ¿qué es una \"variable\"?", options: ["Una tecla rota en el teclado.", "Un espacio reservado para guardar un dato que puede cambiar durante la ejecución.", "Una imagen fija que no se puede mover.", "El cable de alimentación del monitor."], correct: 1, expl: "Una variable funciona como una caja con etiqueta donde se almacena información (como una edad o una puntuación) que puede modificarse con el tiempo." },
  { id: "b2-condicional", topic: "Algoritmos", q: "¿Qué instrucción se utiliza en pseudocódigo cuando el programa debe elegir entre dos caminos según se cumpla o no una condición?", options: ["Repetir.", "Si ... Entonces ... Sino.", "Sumar.", "Borrar todo."], correct: 1, expl: "La estructura condicional evalúa si una condición es verdadera (por ejemplo: \"¿La calificación es mayor a 6?\") para decidir qué acción ejecutar." },
  { id: "b2-bucle", topic: "Algoritmos", q: "¿Qué ocurre si una instrucción de repetición (bucle) no tiene una condición de salida o parada?", options: ["La computadora imprime un reporte en papel.", "El programa se cierra inmediatamente con éxito.", "El programa se queda atrapado en un ciclo infinito.", "Se convierte automáticamente en una hoja de cálculo."], correct: 2, expl: "Todo ciclo debe tener una condición que le indique cuándo detenerse; de lo contrario, continuará repitiéndose sin parar." },
  { id: "b2-rombo", topic: "Algoritmos", q: "En un diagrama de flujo estándar, ¿qué figura geométrica se utiliza comúnmente para representar una toma de decisión o pregunta?", options: ["Un círculo.", "Un rectángulo.", "Un rombo.", "Una estrella."], correct: 2, expl: "El rombo representa una decisión con dos salidas posibles (generalmente \"Sí\" o \"No\")." },
];

/* Reactivos de teoría cuyos números/nombres se generan de la variante (T3, T4, T7, T9, T12 de la propuesta) */
function genDynamicQuestions(rng: () => number): BaseQ[] {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)] as T;
  const powPairs: [number, number][] = [[2, 3], [3, 2], [3, 3], [4, 2], [5, 2], [4, 3], [5, 3]];
  const [pb, pe] = pick(powPairs);
  const powRes = pb ** pe;
  const t3: BaseQ = { id: "t3-potencia", topic: "Operadores", q: `¿Qué resultado da la fórmula =${pb}^${pe}?`, options: [String(pb * pe), String(pb + pe), String(powRes), String(Number(`${pb}${pe}`))], correct: 2, expl: `El símbolo ^ es potencia: ${pb}^${pe} es ${pb} multiplicado por sí mismo ${pe} veces = ${powRes}.` };
  const price = pick([100, 150, 200, 250, 300, 400]);
  const pct = pick([10, 15, 20, 25]);
  const t4: BaseQ = { id: "t4-porcentaje", topic: "Operadores", q: `Un precio de ${price} tiene un descuento de ${pct}%. ¿Qué fórmula calcula el descuento en pesos?`, options: [`=${price}*${pct}%`, `=${price}+${pct}%`, `=${price}/${pct}%`, `=${price}-${pct}%`], correct: 0, expl: `El descuento es el precio por el porcentaje: ${price} × ${pct}% = ${price * pct / 100}. Sumar, restar o dividir el porcentaje no da el descuento.` };
  const thr = pick([50, 80, 100, 120, 150, 200]);
  const t7: BaseQ = { id: "t7-mayor-igual", topic: "Comparación", q: `En A2 está el precio de un artículo. ¿Qué fórmula devuelve VERDADERO si el precio es de ${thr} o más?`, options: [`=A2>${thr}`, `=A2>=${thr}`, `=A2=<${thr}`, `=A2<>${thr}`], correct: 1, expl: `>= significa "mayor o igual": incluye el caso exacto de ${thr}. Con > solo, el ${thr} exacto quedaría fuera, y =< no es una escritura válida.` };
  const namePairs: [string, string][] = [["Ana", "Pérez"], ["Luis", "Gómez"], ["María", "López"], ["Juan", "Ruiz"], ["Sofía", "Torres"], ["Pedro", "Hernández"], ["Lucía", "Méndez"], ["Diego", "Castro"]];
  const [fn, ln] = pick(namePairs);
  const t9: BaseQ = { id: "t9-concatena-espacio", topic: "Concatenación", q: `En A1 está escrito "${fn}" y en B1 está escrito "${ln}". ¿Qué resultado da la fórmula =A1&B1?`, options: [`${fn} ${ln}`, `${fn}${ln}`, `${fn}+${ln}`, "#¡VALOR!"], correct: 1, expl: `El & une los textos tal cual, sin agregar ningún espacio: "${fn}" y "${ln}" dan "${fn}${ln}". Para que salga con espacio hay que pedirlo: =A1&" "&B1.` };
  let a = 2, b = 3, c = 4;
  for (let tries = 0; tries < 20; tries++) {
    a = 2 + Math.floor(rng() * 4); b = 2 + Math.floor(rng() * 4); c = 2 + Math.floor(rng() * 4);
    if (new Set([(a + b) * c, a + b * c, a + b + c, a * b * c]).size === 4) break;
    a = 2; b = 3; c = 4;
  }
  const t12: BaseQ = { id: "t12-parentesis", topic: "Operadores", q: `¿Qué resultado da la fórmula =(${a}+${b})*${c}?`, options: [String(a + b * c), String((a + b) * c), String(a + b + c), String(a * b * c)], correct: 1, expl: `Los paréntesis obligan a sumar primero: (${a}+${b}) = ${a + b}, y ${a + b} × ${c} = ${(a + b) * c}. Sin paréntesis, =${a}+${b}*${c} daría ${a + b * c} porque primero se multiplica.` };
  return [t3, t4, t7, t9, t12];
}
/* ============ Variante única por alumno ============ */
type ShuffledQ = { id: string; topic: string; q: string; options: string[]; correctIdx: number; expl: string };
type Variant = {
  code: string;
  questions: ShuffledQ[];
  practicalCells: string[]; // las 10 celdas de práctica que le tocaron a este alumno
  sales: number[]; // B2:B5
  price: number; // D2
  rate: number; // E2
  powBase: number; // B13
  powExp: number; // C13
  discPrice: number; // B14
  discPct: number; // C14
  firstName: string; // A15
  lastName: string; // B15
  cmpPrice: number; // B16
  qty: number; // B17
  unitPrice: number; // C17
  expected: { sum: number; avg: number; max: number; min: number; count: number; loose: number; tax: number; priceSum: number; pow: number; discount: number; importe: number; cmp: boolean };
};
function buildVariant(initials: string): Variant {
  const seed = hashStr("EXCEL-" + initials);
  const rng = mulberry32(seed);
  const code = "V-" + seed.toString(36).toUpperCase().slice(0, 5);
  // Examen único de 30 reactivos: 20 de teoría elegidos al azar del banco completo
  // (base + nuevas + dinámicas de la variante), con la semilla de las iniciales.
  const ordered = shuffle([...BASE_QUESTIONS, ...NEW_QUESTIONS, ...genDynamicQuestions(rng)], rng).slice(0, 20);
  const questions: ShuffledQ[] = ordered.map((bq) => {
    const idxs = shuffle(bq.options.map((_, i) => i), rng);
    const opts = idxs.map((i) => bq.options[i] as string);
    return { id: bq.id, topic: bq.topic, q: bq.q, options: opts, correctIdx: idxs.indexOf(bq.correct), expl: bq.expl };
  });
  // Valores prácticos únicos
  const salesSet = new Set<number>();
  while (salesSet.size < 4) salesSet.add(5 + Math.floor(rng() * 36)); // 5..40
  const sales = [...salesSet];
  const price = (8 + Math.floor(rng() * 22)) * 10; // 80..290
  const rates = [0.05, 0.08, 0.1, 0.12, 0.16];
  const rate = rates[Math.floor(rng() * rates.length)] as number;
  const sum = sales.reduce((a, b) => a + b, 0);
  // Valores de los ejercicios nuevos (P1–P5), únicos por variante
  const powPairs: [number, number][] = [[2, 3], [3, 2], [3, 3], [4, 2], [5, 2], [4, 3], [5, 3]];
  const powPair = powPairs[Math.floor(rng() * powPairs.length)] ?? ([2, 3] as [number, number]);
  const [powBase, powExp] = powPair;
  const discPrice = (10 + Math.floor(rng() * 30)) * 10; // 100..390
  const discPcts = [10, 15, 20, 25];
  const discPct = discPcts[Math.floor(rng() * discPcts.length)] ?? 10;
  const namePairs: [string, string][] = [["Ana", "Pérez"], ["Luis", "Gómez"], ["María", "López"], ["Juan", "Ruiz"], ["Sofía", "Torres"], ["Pedro", "Hernández"], ["Lucía", "Méndez"], ["Diego", "Castro"]];
  const namePair = namePairs[Math.floor(rng() * namePairs.length)] ?? (["Ana", "Pérez"] as [string, string]);
  const [firstName, lastName] = namePair;
  const cmpPrice = (6 + Math.floor(rng() * 20)) * 10; // 60..250: la variante decide si es >= 100
  const qty = 2 + Math.floor(rng() * 8); // 2..9
  const unitPrice = (15 + Math.floor(rng() * 36)) * 10; // 150..500
  const expected = {
    sum, avg: sum / sales.length, max: Math.max(...sales), min: Math.min(...sales),
    count: sales.length, loose: (sales[0] as number) + (sales[2] as number), tax: Math.round(price * rate * 100) / 100,
    priceSum: price * 4 + 30, // D2:D5 = precio, precio+40, precio+20, precio-30
    pow: powBase ** powExp, discount: (discPrice * discPct) / 100, importe: qty * unitPrice, cmp: cmpPrice >= 100,
  };
  // Los otros 10 reactivos: práctica de Excel. Mezcla fija garantizada: siempre
  // 10 de los 13 ejercicios prácticos, elegidos con la misma semilla.
  const ALL_PRACTICAL_CELLS = ["B7", "B8", "B9", "B10", "B11", "C2", "F2", "D7", "D13", "D14", "C15", "C16", "D17"];
  const practicalCells = shuffle(ALL_PRACTICAL_CELLS, rng).slice(0, 10);
  return { code, questions, practicalCells, sales, price, rate, powBase, powExp, discPrice, discPct, firstName, lastName, cmpPrice, qty, unitPrice, expected };
}

/* ============ Evaluador de fórmulas (básico) ============ */
function colToNum(col: string): number { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseAddr(addr: string): { col: number; row: number } | null {
  const m = addr.replace(/\$/g, "").match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { col: colToNum(m[1] as string), row: parseInt(m[2] as string, 10) };
}
function rangeValues(range: string, values: Record<string, number>): number[] {
  const parts = range.split(":");
  if (parts.length !== 2) return [];
  const a = parseAddr(parts[0] as string); const b = parseAddr(parts[1] as string);
  if (!a || !b) return [];
  const out: number[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      let col = ""; let cc = c;
      while (cc > 0) { const rem = (cc - 1) % 26; col = String.fromCharCode(65 + rem) + col; cc = Math.floor((cc - 1) / 26); }
      const v = values[`${col}${r}`];
      if (typeof v === "number") out.push(v);
    }
  }
  return out;
}
function evaluateFormula(raw: string, values: Record<string, number>): number | null {
  try {
    let expr = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (expr.startsWith("=")) expr = expr.slice(1);
    if (!expr) return null;
    // Funciones con rango o lista
    const fnNames: Record<string, string> = { SUMA: "SUM", SUM: "SUM", PROMEDIO: "AVG", AVERAGE: "AVG", MAX: "MAX", MIN: "MIN", CONTAR: "COUNT", COUNT: "COUNT", POTENCIA: "POW", POWER: "POW" };
    let guard = 0;
    const fnRe = /(SUMA|PROMEDIO|AVERAGE|CONTAR|COUNT|SUM|MAX|MIN|POTENCIA|POWER)\(([^()]*)\)/;
    let m = expr.match(fnRe);
    while (m && guard++ < 10) {
      const kind = fnNames[m[1] as string] as string;
      const arg = m[2] as string;
      let vals: number[] = [];
      if (arg.includes(":")) vals = rangeValues(arg, values);
      else {
        const parts = arg.split(/[;,]/).filter(Boolean);
        for (const p of parts) {
          const key = p.replace(/\$/g, "");
          const v = values[key];
          if (typeof v === "number") vals.push(v);
          else if (/^-?\d+(\.\d+)?$/.test(p)) vals.push(parseFloat(p));
        }
      }
      let res = 0;
      if (kind === "SUM") res = vals.reduce((a, b) => a + b, 0);
      else if (kind === "AVG") res = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      else if (kind === "MAX") res = vals.length ? Math.max(...vals) : 0;
      else if (kind === "MIN") res = vals.length ? Math.min(...vals) : 0;
      else if (kind === "COUNT") res = vals.length;
      else if (kind === "POW") res = vals.length >= 2 ? (vals[0] as number) ** (vals[1] as number) : 0;
      expr = expr.replace(m[0], String(res));
      m = expr.match(fnRe);
    }
    // Referencias sueltas
    expr = expr.replace(/\$?([A-Z]+\$?\d+)/g, (_full, ref: string) => {
      const key = ref.replace(/\$/g, "");
      const v = values[key];
      return typeof v === "number" ? String(v) : "0";
    });
    // Porcentaje: 10% → (10/100)
    expr = expr.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
    expr = expr.replace(/,/g, ".").replace(/;/g, "+");
    if (!/^[0-9.+\-*/()^]+$/.test(expr)) return null;
    const result = evalArithmetic(expr);
    return result !== null && Number.isFinite(result) ? Math.round(result * 10000) / 10000 : null;
  } catch { return null; }
}
/* Parser aritmético seguro: solo números, + - * / y paréntesis */
function evalArithmetic(expr: string): number | null {
  let pos = 0;
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (expr[pos] === "+" || expr[pos] === "-") {
      const op = expr[pos++]; const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parsePower();
    if (left === null) return null;
    while (expr[pos] === "*" || expr[pos] === "/") {
      const op = expr[pos++]; const right = parsePower();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parsePower(): number | null {
    const base = parseFactor();
    if (base === null) return null;
    if (expr[pos] === "^") { pos++; const exp = parsePower(); if (exp === null) return null; return base ** exp; }
    return base;
  }
  function parseFactor(): number | null {
    if (expr[pos] === "-") { pos++; const v = parseFactor(); return v === null ? null : -v; }
    if (expr[pos] === "+") { pos++; return parseFactor(); }
    if (expr[pos] === "(") { pos++; const v = parseExpr(); if (v === null || expr[pos] !== ")") return null; pos++; return v; }
    const m = expr.slice(pos).match(/^\d+(\.\d+)?/);
    if (!m) return null;
    pos += m[0].length;
    return parseFloat(m[0]);
  }
  const result = parseExpr();
  if (result === null || pos !== expr.length) return null;
  return result;
}
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/* Evaluador de fórmulas de texto con & (concatenación): términos = referencias o literales "..." */
function evaluateTextFormula(raw: string, texts: Record<string, string>, values: Record<string, number>): string | null {
  try {
    let expr = raw.trim();
    if (expr.startsWith("=")) expr = expr.slice(1);
    if (!expr) return null;
    const parts: string[] = [];
    let cur = ""; let inQ = false;
    for (const ch of expr) {
      if (ch === '"') inQ = !inQ;
      if (ch === "&" && !inQ) { parts.push(cur); cur = ""; } else cur += ch;
    }
    parts.push(cur);
    let out = "";
    for (const pRaw of parts) {
      const p = pRaw.trim();
      if (/^"[^"]*"$/.test(p)) { out += p.slice(1, -1); continue; }
      const key = p.replace(/\$/g, "").toUpperCase();
      if (!/^[A-Z]+\d+$/.test(key)) return null;
      if (key in texts) out += texts[key] as string;
      else if (typeof values[key] === "number") out += fmtNum(values[key] as number);
      else return null;
    }
    return out;
  } catch { return null; }
}

/* Evaluador de comparaciones: devuelve VERDADERO/FALSO según los valores de la variante */
function evaluateLogicFormula(raw: string, values: Record<string, number>): boolean | null {
  const expr = raw.trim().toUpperCase().replace(/\s+/g, "");
  const body = expr.startsWith("=") ? expr.slice(1) : expr;
  const m = body.match(/^(.+?)(>=|<=|<>|>|<|=)(.+)$/);
  if (!m) return null;
  const resolve = (s: string): number | null => {
    const key = s.replace(/\$/g, "");
    if (/^[A-Z]+\d+$/.test(key)) { const v = values[key]; return typeof v === "number" ? v : null; }
    if (/^-?\d+(\.\d+)?$/.test(key)) return parseFloat(key);
    return null;
  };
  const a = resolve(m[1] as string); const b = resolve(m[3] as string);
  if (a === null || b === null) return null;
  switch (m[2]) {
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "<>": return a !== b;
    case ">": return a > b;
    case "<": return a < b;
    case "=": return a === b;
    default: return null;
  }
}

/* ============ Práctica: tareas ============ */
type PracTask = { cell: string; title: string; kind?: "number" | "text" | "logic"; instruction: (v: Variant) => string; check: (formula: string, value: number | null, text: string | null, v: Variant) => { ok: boolean; msg: string } };
const hasRange = (f: string, r: string) => f.replace(/\s+/g, "").toUpperCase().includes(r);
const PRACTICAL: PracTask[] = [
  { cell: "B7", title: "Total de ventas", instruction: () => "En B7 escribe el total de las ventas de B2 a B5.", check: (f, val, _text, v) => ({ ok: hasRange(f, "B2:B5") && f.toUpperCase().includes("SUMA") && val !== null && Math.abs(val - v.expected.sum) < 0.01, msg: `Debía ser =SUMA(B2:B5) → ${fmtNum(v.expected.sum)}` }) },
  { cell: "B8", title: "Promedio de ventas", instruction: () => "En B8 escribe el promedio de las ventas de B2 a B5.", check: (f, val, _text, v) => ({ ok: hasRange(f, "B2:B5") && f.toUpperCase().includes("PROMEDIO") && val !== null && Math.abs(val - v.expected.avg) < 0.01, msg: `Debía ser =PROMEDIO(B2:B5) → ${fmtNum(v.expected.avg)}` }) },
  { cell: "B9", title: "Venta más grande", instruction: () => "En B9 escribe la venta más grande de B2 a B5.", check: (f, val, _text, v) => ({ ok: hasRange(f, "B2:B5") && f.toUpperCase().includes("MAX") && val !== null && Math.abs(val - v.expected.max) < 0.01, msg: `Debía ser =MAX(B2:B5) → ${fmtNum(v.expected.max)}` }) },
  { cell: "B10", title: "Venta más chica", instruction: () => "En B10 escribe la venta más chica de B2 a B5.", check: (f, val, _text, v) => ({ ok: hasRange(f, "B2:B5") && f.toUpperCase().includes("MIN") && val !== null && Math.abs(val - v.expected.min) < 0.01, msg: `Debía ser =MIN(B2:B5) → ${fmtNum(v.expected.min)}` }) },
  { cell: "B11", title: "Cantidad de datos", instruction: () => "En B11 escribe cuántos datos numéricos hay de B2 a B5.", check: (f, val, _text, v) => ({ ok: hasRange(f, "B2:B5") && f.toUpperCase().includes("CONTAR") && val !== null && Math.abs(val - v.expected.count) < 0.01, msg: `Debía ser =CONTAR(B2:B5) → ${fmtNum(v.expected.count)}` }) },
  { cell: "C2", title: "Suma parcial", instruction: () => "En C2 escribe la suma de B2 y B4 únicamente.", check: (f, val, _text, v) => { const up = f.toUpperCase().replace(/\s+/g, ""); const okRange = !up.includes("B2:B4"); const hasCells = up.includes("B2") && up.includes("B4"); return { ok: okRange && hasCells && (up.includes("+") || up.includes(";")) && val !== null && Math.abs(val - v.expected.loose) < 0.01, msg: `Debía sumar solo B2+B4 → ${fmtNum(v.expected.loose)} (con + o con ;, no con :)` }; } },
  { cell: "F2", title: "Impuesto", instruction: () => "En F2 calcula el impuesto del precio en D2 aplicando la tasa que está en E2.", check: (f, val, _text, v) => { const up = f.toUpperCase().replace(/\s+/g, ""); const hasDollar = up.includes("$E$2") || up.includes("$E2") || up.includes("E$2"); return { ok: hasDollar && up.includes("D2") && val !== null && Math.abs(val - v.expected.tax) < 0.05, msg: `Debía ser =D2*$E$2 → ${fmtNum(v.expected.tax)} (con $ fijando E2)` }; } },
  { cell: "D7", title: "Total de precios", instruction: () => "En D7 escribe el total de los precios de D2 a D5.", check: (f, val, _text, v) => ({ ok: hasRange(f, "D2:D5") && val !== null && Math.abs(val - v.expected.priceSum) < 0.01, msg: `Debía ser =SUMA(D2:D5) → ${fmtNum(v.expected.priceSum)}` }) },
  { cell: "D13", title: "Potencia", instruction: () => "En D13 calcula la base de B13 elevada al exponente de C13.", check: (f, val, _text, v) => { const up = f.toUpperCase().replace(/\s+/g, ""); return { ok: up.includes("B13") && up.includes("C13") && (up.includes("^") || up.includes("POTENCIA")) && val !== null && Math.abs(val - v.expected.pow) < 0.01, msg: `Debía ser =B13^C13 → ${fmtNum(v.expected.pow)}` }; } },
  { cell: "D14", title: "Descuento en pesos", instruction: () => "En D14 calcula el descuento en pesos del precio de B14 según el porcentaje de C14.", check: (f, val, _text, v) => { const up = f.toUpperCase().replace(/\s+/g, ""); return { ok: up.includes("B14") && up.includes("C14") && val !== null && Math.abs(val - v.expected.discount) < 0.01, msg: `Debía ser =B14*C14% → ${fmtNum(v.expected.discount)}` }; } },
  { cell: "C15", title: "Nombre completo", kind: "text", instruction: () => "En C15 une el nombre de A15 y el apellido de B15 con un espacio entre los dos.", check: (f, _val, text, v) => { const up = f.replace(/\s+/g, "").toUpperCase(); return { ok: up.includes("A15") && up.includes("B15") && up.includes("&") && text === `${v.firstName} ${v.lastName}`, msg: `Debía ser =A15&" "&B15 → ${v.firstName} ${v.lastName} (con el espacio entre nombre y apellido)` }; } },
  { cell: "C16", title: "¿Precio de 100 o más?", kind: "logic", instruction: () => "En C16 escribe una fórmula que diga si el precio de B16 es de 100 o más.", check: (f, _val, text, v) => { const up = f.toUpperCase().replace(/\s+/g, "").replace(/\$/g, ""); return { ok: up.includes("B16>=100") && text === (v.expected.cmp ? "VERDADERO" : "FALSO"), msg: `Debía ser =B16>=100 → ${v.expected.cmp ? "VERDADERO" : "FALSO"} (según el precio de tu variante)` }; } },
  { cell: "D17", title: "Importe", instruction: () => "En D17 calcula el importe: la cantidad de B17 por el precio unitario de C17.", check: (f, val, _text, v) => { const up = f.toUpperCase().replace(/\s+/g, ""); return { ok: up.includes("B17") && up.includes("C17") && up.includes("*") && val !== null && Math.abs(val - v.expected.importe) < 0.01, msg: `Debía ser =B17*C17 → ${fmtNum(v.expected.importe)}` }; } },
];
const EDITABLE = PRACTICAL.map((t) => t.cell);

/* ============ Parseo de lista del maestro ============ */
function parseRosterText(text: string): { initials: string; fullName: string }[] {
  const out: { initials: string; fullName: string }[] = [];
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Formato: "KGI — Nombre" | "KGI | Nombre" | "KGI, Nombre" | "Nombre Completo" | "KGI"
    const sep = line.split(/\s*[—|]\s*|\s*,\s*|\t+/);
    const first = (sep[0] ?? "").trim();
    const rest = sep.slice(1).join(" ").trim();
    if (/^[A-Za-zÁÉÍÓÚÑ]{2,8}$/.test(first) && rest) {
      out.push({ initials: normInitials(first), fullName: rest });
    } else if (/^[A-Za-zÁÉÍÓÚÑ]{2,8}$/.test(line)) {
      out.push({ initials: normInitials(line), fullName: "" });
    } else {
      // Nombre completo: derivar iniciales (primera letra de cada palabra, máx 4)
      const words = line.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, "").split(/\s+/).filter(Boolean);
      if (words.length >= 2) out.push({ initials: words.slice(0, 4).map((w) => (w[0] as string).toUpperCase()).join(""), fullName: line });
      else if (words.length === 1) out.push({ initials: normInitials(words[0] as string), fullName: "" });
    }
  }
  return out.filter((e) => e.initials.length >= 2);
}

/* ============ App ============ */
type Phase = "intro" | "exam" | "result" | "teacher";
type Grade = { theoryOk: Record<string, boolean>; pracOk: Record<string, { ok: boolean; msg: string }>; theoryScore: number; pracScore: number; total: number; totalPoints: number; pct: number };

export function App() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("intro");
  const [fullName, setFullName] = useState("");
  const [initialsInput, setInitialsInput] = useState("");
  const [entryError, setEntryError] = useState("");
  const [session, setSession] = useState<{ name: string; initials: string; variant: Variant } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [formulas, setFormulas] = useState<Record<string, string>>({});
  const [selectedCell, setSelectedCell] = useState<string>("B7");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [rosterText, setRosterText] = useState("");
  const [teacherMsg, setTeacherMsg] = useState("");

  const roster = useQuery({ queryKey: ["roster"], queryFn: () => api.getRoster({}) });
  const results = useQuery({ queryKey: ["results"], queryFn: () => api.listResults({ limit: 100 }), enabled: phase === "teacher" || phase === "result" });

  const submitMut = useMutation({
    mutationFn: async (args: { studentName: string; initials: string; variantCode: string; score: number; totalPoints: number; percentage: number; theoryScore: number; practicalScore: number; details: string }) => await api.submitResult(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["results"] }),
  });
  const saveRosterMut = useMutation({
    mutationFn: async (entries: { initials: string; fullName: string }[]) => await api.saveRoster({ entries }),
    onSuccess: (r) => { setTeacherMsg(`Lista guardada: ${r.count} alumno(s). Sirve para identificar: si las iniciales coinciden, se completa el nombre del alumno.`); queryClient.invalidateQueries({ queryKey: ["roster"] }); },
    onError: (e) => setTeacherMsg(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`),
  });
  const clearRosterMut = useMutation({
    mutationFn: async () => await api.clearRoster({}),
    onSuccess: () => { setTeacherMsg("Lista borrada. Sin lista, el examen usa el nombre que escriba cada alumno."); queryClient.invalidateQueries({ queryKey: ["roster"] }); },
  });

  const rosterCount = roster.data?.count ?? 0;
  const rosterMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of roster.data?.entries ?? []) m.set(e.initials.toUpperCase(), e.fullName);
    return m;
  }, [roster.data]);

  function startExam() {
    const ini = normInitials(initialsInput);
    if (ini.length < 2) { setEntryError("Escribe tus iniciales (al menos 2 letras), en el orden de la lista oficial, apellidos primero. Ejemplo: AGUILAR MENDEZ OSCAR EMILIO → AMOE."); return; }
    const fromList = rosterMap.get(ini) ?? "";
    const name = (fullName.trim() || fromList).trim();
    if (!name) { setEntryError("Escribe tu nombre completo, además de tus iniciales."); return; }
    setEntryError("");
    const variant = buildVariant(ini);
    setSession({ name, initials: ini, variant });
    setAnswers({}); setFormulas({}); setGrade(null); setSelectedCell(variant.practicalCells[0] ?? "B7");
    setPhase("exam");
  }

  // Valores de la hoja para la variante activa
  const sheetValues = useMemo<Record<string, number>>(() => {
    if (!session) return {};
    const v = session.variant;
    const map: Record<string, number> = { E2: v.rate, D2: v.price };
    v.sales.forEach((n, i) => { map[`B${i + 2}`] = n; });
    map["D3"] = v.price + 40; map["D4"] = v.price + 20; map["D5"] = v.price - 30;
    map["B13"] = v.powBase; map["C13"] = v.powExp;
    map["B14"] = v.discPrice; map["C14"] = v.discPct;
    map["B16"] = v.cmpPrice;
    map["B17"] = v.qty; map["C17"] = v.unitPrice;
    return map;
  }, [session]);

  // Textos de la hoja para la variante activa (concatenación)
  const sheetTexts = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (session) { map["A15"] = session.variant.firstName; map["B15"] = session.variant.lastName; }
    return map;
  }, [session]);

  function computeGrade(): Grade | null {
    if (!session) return null;
    const v = session.variant;
    const theoryOk: Record<string, boolean> = {};
    let theoryScore = 0;
    for (const q of v.questions) { const ok = answers[q.id] === q.correctIdx; theoryOk[q.id] = ok; if (ok) theoryScore += 1; }
    const pracOk: Grade["pracOk"] = {};
    let pracScore = 0;
    for (const t of PRACTICAL.filter((x) => v.practicalCells.includes(x.cell))) {
      const f = formulas[t.cell] ?? "";
      let val: number | null = null;
      let text: string | null = null;
      if (f) {
        if (t.kind === "text") text = evaluateTextFormula(f, sheetTexts, sheetValues);
        else if (t.kind === "logic") { const b = evaluateLogicFormula(f, sheetValues); text = b === null ? null : b ? "VERDADERO" : "FALSO"; }
        else val = evaluateFormula(f, sheetValues);
      }
      const r = t.check(f, val, text, v);
      pracOk[t.cell] = r; if (r.ok) pracScore += 1;
    }
    const totalPoints = v.questions.length + v.practicalCells.length; // 20 + 10 = 30
    const total = theoryScore + pracScore;
    return { theoryOk, pracOk, theoryScore, pracScore, total, totalPoints, pct: Math.round((total / totalPoints) * 100) };
  }

  function finishExam() {
    const g = computeGrade();
    if (!g || !session) return;
    setGrade(g);
    setPhase("result");
    submitMut.mutate({
      studentName: session.name, initials: session.initials, variantCode: session.variant.code,
      score: g.total, totalPoints: g.totalPoints, percentage: g.pct,
      theoryScore: g.theoryScore, practicalScore: g.pracScore,
      details: JSON.stringify({ sales: session.variant.sales, price: session.variant.price, rate: session.variant.rate, powBase: session.variant.powBase, powExp: session.variant.powExp, discPrice: session.variant.discPrice, discPct: session.variant.discPct, firstName: session.variant.firstName, lastName: session.variant.lastName, cmpPrice: session.variant.cmpPrice, qty: session.variant.qty, unitPrice: session.variant.unitPrice, questionIds: session.variant.questions.map((q) => q.id), practicalCells: session.variant.practicalCells, theoryOk: g.theoryOk, prac: Object.fromEntries(Object.entries(g.pracOk).map(([k, val]) => [k, val.ok])) }),
    });
  }

  const answeredCount = Object.keys(answers).length;
  const pracDone = (session?.variant.practicalCells ?? EDITABLE).filter((c) => (formulas[c] ?? "").trim().length > 1).length;

  /* ---------- INTRO ---------- */
  if (phase === "intro") {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="mx-auto max-w-2xl px-4 pb-10 pt-6">
          <div className="rounded-2xl p-5 sm:p-7" style={{ background: "#217346", color: "#fff" }}>
            <p className="text-xs font-bold uppercase tracking-widest opacity-80">Nivel básico · Se califica solo</p>
            <h1 className="mt-2 text-3xl font-extrabold leading-tight">Examen de Excel</h1>
            <p className="mt-2 text-sm leading-relaxed opacity-95">Examen de teoría de opción múltiple y ejercicios prácticos en una hoja. Cada alumno recibe un examen único según sus iniciales y la calificación sale al instante al terminar.</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-white/15 px-3 py-1.5">30 reactivos por examen</span>
              <span className="rounded-full bg-white/15 px-3 py-1.5">Calificación en base a 30</span>
            </div>
          </div>

          <section className="mt-5 rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Datos del alumno">
            <h2 className="text-lg font-bold">Tus datos para entrar</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>
              {rosterCount > 0
                ? `Hay una lista de ${rosterCount} alumnos cargada para identificarte: si tus iniciales coinciden con un alumno de la lista, tu nombre se completa solo. Si no coinciden, entra con el nombre que escribas.`
                : "Escribe tus iniciales: la primera letra de cada palabra de tu nombre, en el orden de la lista oficial (apellidos primero). Ejemplo: AGUILAR MENDEZ OSCAR EMILIO → AMOE. Con eso se genera tu examen único."}
            </p>
            <label htmlFor="full-name" className="mt-4 block text-sm font-semibold">Nombre completo</label>
            <input id="full-name" {...FIELDS.submitResult.studentName} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ej.: Karlo Gamboa Ibarria" className="mt-1 w-full rounded-xl border px-3 py-2.5 text-base" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }} />
            <label htmlFor="initials" className="mt-4 block text-sm font-semibold">Tus iniciales</label>
            <input id="initials" {...FIELDS.submitResult.initials} value={initialsInput} onChange={(e) => setInitialsInput(e.target.value.toUpperCase())} placeholder="Ej.: KGI" className="mt-1 w-full rounded-xl border px-3 py-2.5 font-mono text-lg font-bold uppercase tracking-[0.3em]" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }} aria-describedby="initials-help" />
            <p id="initials-help" className="mt-1 text-xs" style={{ color: "var(--dim)" }}>Sin espacios ni puntos. Tu variante de examen se genera con estas iniciales: dos alumnos con iniciales distintas no reciben el mismo examen.</p>
            {initialsInput.trim().length >= 2 && (
              <p className="mt-3 rounded-xl px-3 py-2 font-mono text-sm font-semibold" style={{ background: "#EFF6F1", color: "#185C37" }}>
                Tu variante será: {buildVariant(normInitials(initialsInput)).code}
              </p>
            )}
            {entryError && <p role="alert" className="mt-3 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "#FDECEC", color: "#8B1E1E" }}>{entryError}</p>}
            <button type="button" onClick={startExam} className="mt-5 w-full rounded-xl py-3 text-base font-bold text-white" style={{ background: "#217346" }}>Comenzar mi examen</button>
          </section>

          <button type="button" onClick={() => setPhase("teacher")} className="mt-4 w-full rounded-xl border py-3 text-sm font-bold" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>
            Panel del maestro: cargar lista de alumnos y ver resultados
          </button>
          <p className="mt-3 text-center text-xs" style={{ color: "var(--dim)" }}>Grupo de 54 alumnos · Cada resultado se guarda con iniciales y variante.</p>
        </main>
      </div>
    );
  }

  /* ---------- TEACHER ---------- */
  if (phase === "teacher") {
    const parsedPreview = parseRosterText(rosterText);
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="mx-auto max-w-3xl px-4 pb-10 pt-6">
          <button type="button" onClick={() => setPhase("intro")} className="text-sm font-bold" style={{ color: "var(--accent)" }}>← Volver al inicio</button>
          <h1 className="mt-2 text-2xl font-extrabold">Panel del maestro</h1>

          <section className="mt-4 rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Lista de alumnos">
            <h2 className="text-lg font-bold">Lista de alumnos {rosterCount > 0 ? `(${rosterCount} cargados)` : "(sin cargar)"}</h2>
            {roster.data && !roster.data.dbReady && <p role="alert" className="mt-2 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "#FDECEC", color: "#8B1E1E" }}>Postgres no está disponible en este entorno (falta DATABASE_URL): la lista no se puede leer ni guardar aquí.</p>}
            <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
              Pega la lista de tus 54 alumnos, uno por línea. Acepta cualquiera de estos formatos: el nombre completo (el sistema calcula las iniciales), o iniciales y nombre. Ejemplos:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xl p-3 font-mono text-xs" style={{ background: "var(--bg)" }}>{"Karlo Gamboa Ibarria\nKGI — Karlo Gamboa Ibarria\nKGI, Karlo Gamboa Ibarria"}</pre>
            <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>La lista sirve solo para identificar: si las iniciales del alumno coinciden con un registro, su nombre se completa automáticamente cuando lo deja vacío. El examen acepta cualquier iniciales, estén o no en la lista.</p>
            <label htmlFor="roster-text" className="mt-4 block text-sm font-semibold">Pega aquí la lista</label>
            <textarea id="roster-text" value={rosterText} onChange={(e) => setRosterText(e.target.value)} rows={8} placeholder={"Un alumno por línea…"} className="mt-1 w-full rounded-xl border px-3 py-2 font-mono text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }} />
            {rosterText.trim() && <p className="mt-2 text-sm font-semibold">Se detectaron {parsedPreview.length} alumno(s): {parsedPreview.slice(0, 8).map((p) => p.initials).join(", ")}{parsedPreview.length > 8 ? "…" : ""}</p>}
            {teacherMsg && <p role="status" className="mt-2 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "#EFF6F1", color: "#185C37" }}>{teacherMsg}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={parsedPreview.length === 0 || saveRosterMut.isPending} onClick={() => saveRosterMut.mutate(parsedPreview)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: "#217346" }}>Guardar lista (reemplaza la anterior)</button>
              <button type="button" disabled={rosterCount === 0 || clearRosterMut.isPending} onClick={() => clearRosterMut.mutate()} className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>Borrar lista</button>
            </div>
            {rosterCount > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-3" aria-label="Alumnos registrados">
                {(roster.data?.entries ?? []).map((e) => (
                  <li key={e.id} className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg)" }}><span className="font-mono font-bold">{e.initials}</span>{e.fullName ? <span style={{ color: "var(--dim)" }}> · {e.fullName}</span> : null}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-4 rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Resultados">
            <h2 className="text-lg font-bold">Resultados guardados ({results.data?.results.length ?? 0})</h2>
            {results.isPending && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>Cargando…</p>}
            {results.isError && <p role="alert" className="mt-2 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "#FDECEC", color: "#8B1E1E" }}>No se pudieron cargar los resultados desde Postgres. Revisa que la variable DATABASE_URL esté configurada y el servicio de Postgres esté en línea.</p>}
            {results.data && !results.data.dbReady && <p role="alert" className="mt-2 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "#FDECEC", color: "#8B1E1E" }}>Postgres no está disponible en este entorno (falta DATABASE_URL): no hay almacén del cual leer resultados.</p>}
            {(results.data?.results.length ?? 0) === 0 && !results.isPending && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>Todavía no hay exámenes terminados.</p>}
            <div className="mt-3 space-y-2">
              {(results.data?.results ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--bg)" }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{r.studentName} <span className="font-mono text-xs" style={{ color: "var(--dim)" }}>{r.initials} · {r.variantCode}</span></p>
                    <p className="text-xs" style={{ color: "var(--dim)" }}>Teoría {fmtNum(r.theoryScore)} · Práctica {fmtNum(r.practicalScore)} · {new Date(r.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-3 py-1 font-mono text-sm font-bold text-white" style={{ background: r.percentage >= 60 ? "#217346" : "#D64541" }}>{fmtNum(r.percentage)}%</span>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border p-5 text-sm leading-relaxed" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--dim)" }} aria-label="Publicación en Railway">
            <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Publicar en Railway</h2>
            <p className="mt-1">En la carpeta del proyecto vienen <span className="font-mono">railway.json</span>, <span className="font-mono">Dockerfile</span> y <span className="font-mono">.env.example</span> con las variables documentadas, además de la guía <span className="font-mono">DESPLIEGUE-RAILWAY.md</span> paso a paso. Esta versión dentro de Muse ya guarda los resultados; la de Railway usa los mismos archivos de despliegue incluidos.</p>
          </section>
        </main>
      </div>
    );
  }

  /* ---------- RESULT ---------- */
  if (phase === "result" && session && grade) {
    const v = session.variant;
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="mx-auto max-w-2xl px-4 pb-10 pt-6">
          <div className="rounded-2xl p-6 text-center text-white" style={{ background: grade.pct >= 60 ? "#217346" : "#B23A48" }}>
            <p className="text-sm font-semibold opacity-90">{session.name} · <span className="font-mono">{session.initials}</span> · Variante <span className="font-mono">{v.code}</span></p>
            <p className="mt-2 text-6xl font-extrabold">{fmtNum(grade.total)} / {fmtNum(grade.totalPoints)}</p>
            <p className="mt-1 text-sm opacity-95">Aciertos en base a {fmtNum(grade.totalPoints)} · Equivale a {fmtNum(grade.pct)} en base a 100 · {grade.pct >= 60 ? "¡Aprobado! Buen trabajo." : "A repasar y reintentar: revisa las correcciones de abajo."}</p>
            <p className="mt-2 text-xs opacity-80">{submitMut.isPending ? "Guardando tu resultado…" : submitMut.isSuccess ? "Resultado guardado ✓ El maestro puede verlo en su panel." : submitMut.isError ? "No se pudo guardar en línea, pero tu calificación es esta." : ""}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>Teoría</p>
              <p className="mt-1 text-2xl font-extrabold">{fmtNum(grade.theoryScore)} / {v.questions.length}</p>
            </div>
            <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>Práctica en la hoja</p>
              <p className="mt-1 text-2xl font-extrabold">{fmtNum(grade.pracScore)} / {v.practicalCells.length}</p>
            </div>
          </div>

          <section className="mt-5" aria-label="Revisión de práctica">
            <h2 className="text-lg font-bold">Revisión de la práctica</h2>
            <div className="mt-2 space-y-2">
              {PRACTICAL.filter((t) => v.practicalCells.includes(t.cell)).map((t) => { const r = grade.pracOk[t.cell]; const ok = r?.ok ?? false; return (
                <div key={t.cell} className="rounded-xl border px-3 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                  <p className="font-bold">{ok ? "✅" : "❌"} {t.title} <span className="font-mono text-xs" style={{ color: "var(--dim)" }}>celda {t.cell}</span></p>
                  <p className="font-mono text-xs" style={{ color: "var(--dim)" }}>Tu fórmula: {(formulas[t.cell] ?? "").trim() || "(vacía)"}</p>
                  {!ok && <p className="mt-0.5 text-xs font-semibold" style={{ color: "#8B1E1E" }}>{r?.msg}</p>}
                </div> ); })}
            </div>
          </section>

          <section className="mt-5" aria-label="Revisión de teoría">
            <h2 className="text-lg font-bold">Correcciones de teoría</h2>
            <div className="mt-2 space-y-2">
              {v.questions.map((q, i) => { const ok = grade.theoryOk[q.id]; return (
                <div key={q.id} className="rounded-xl border px-3 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", opacity: ok ? 0.75 : 1 }}>
                  <p className="font-semibold">{ok ? "✅" : "❌"} {i + 1}. {q.q}</p>
                  {!ok && <p className="mt-1 text-xs">Respuesta correcta: <strong>{q.options[q.correctIdx]}</strong></p>}
                  {!ok && <p className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>{q.expl}</p>}
                </div> ); })}
            </div>
          </section>

          <button type="button" onClick={() => { setPhase("intro"); setSession(null); setAnswers({}); setFormulas({}); setGrade(null); }} className="mt-6 w-full rounded-xl py-3 font-bold text-white" style={{ background: "#217346" }}>Terminar y volver al inicio</button>
        </main>
      </div>
    );
  }

  /* ---------- EXAM ---------- */
  if (!session) return null;
  const v = session.variant;
  const editableCells = v.practicalCells;
  const selectedPractical = PRACTICAL.filter((t) => v.practicalCells.includes(t.cell));
  const cols = ["A", "B", "C", "D", "E", "F"];
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const labels: Record<string, string> = {
    A1: "Producto", B1: "Ventas", C1: "Suma suelta", D1: "Precio", E1: "Tasa", F1: "Impuesto",
    A2: "Manzanas", A3: "Peras", A4: "Uvas", A5: "Mangos",
    A7: "Total ventas →", A8: "Promedio →", A9: "Máximo →", A10: "Mínimo →", A11: "¿Cuántos datos? →", C7: "Total precios →",
    A13: "Potencia →", A14: "Descuento →", A16: "Precio →", A17: "Importe →",
  };
  const resultTextFor = (t: PracTask, f: string): string => {
    if (t.kind === "text") { const s = evaluateTextFormula(f, sheetTexts, sheetValues); return s === null ? "#¿NOMBRE?" : s; }
    if (t.kind === "logic") { const b = evaluateLogicFormula(f, sheetValues); return b === null ? "#¿NOMBRE?" : b ? "VERDADERO" : "FALSO"; }
    const val = evaluateFormula(f, sheetValues);
    return val === null ? "#¿NOMBRE?" : fmtNum(val);
  };
  const displayFor = (addr: string): string => {
    if (editableCells.includes(addr)) {
      const f = (formulas[addr] ?? "").trim();
      if (!f) return "";
      const t = PRACTICAL.find((x) => x.cell === addr);
      return t ? resultTextFor(t, f) : "";
    }
    if (labels[addr]) return labels[addr] as string;
    if (addr === "E2") return `${Math.round(v.rate * 100)}%`;
    if (addr === "C14") return `${v.discPct}%`;
    if (sheetTexts[addr]) return sheetTexts[addr] as string;
    const n = sheetValues[addr];
    return typeof n === "number" ? fmtNum(n) : "";
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="sticky top-0 z-20 border-b px-4 py-2.5" style={{ background: "var(--surface)", borderColor: "var(--border)", paddingTop: "max(0.6rem, env(safe-area-inset-top))" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-bold">{session.name} <span className="font-mono text-xs font-semibold" style={{ color: "var(--dim)" }}>{session.initials} · {v.code}</span></p>
          <p className="shrink-0 text-xs font-semibold" style={{ color: "var(--dim)" }}>Teoría {answeredCount}/{v.questions.length} · Práctica {pracDone}/{v.practicalCells.length}</p>
        </div>
        <div className="mx-auto mt-2 h-2 max-w-3xl overflow-hidden rounded-full" style={{ background: "var(--border)" }} role="progressbar" aria-valuenow={answeredCount + pracDone} aria-valuemin={0} aria-valuemax={v.questions.length + v.practicalCells.length} aria-label="Progreso del examen">
          <div className="h-full rounded-full transition-all" style={{ width: `${((answeredCount + pracDone) / (v.questions.length + v.practicalCells.length)) * 100}%`, background: "#217346" }} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-12 pt-4">
        {/* PRÁCTICA primero en móvil: la hoja es el héroe */}
        <section aria-label="Práctica en hoja simulada">
          <h2 className="text-xl font-extrabold">Parte 1 · Práctica en la hoja</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{selectedPractical.length} ejercicios prácticos (1 punto cada uno). Toca una celda amarilla y escribe tu fórmula en la barra de fórmulas. El resultado se calcula solo.</p>

          {/* Barra de fórmulas */}
          <div className="mt-3 flex items-stretch gap-2">
            <div className="flex items-center rounded-lg border px-3 font-mono text-sm font-bold" style={{ borderColor: "var(--border)", background: "var(--surface)", minWidth: 58, justifyContent: "center" }} aria-label="Celda seleccionada">{selectedCell}</div>
            <div className="flex items-center rounded-lg px-2 font-mono text-sm italic" style={{ color: "var(--dim)" }}>fx</div>
            <input aria-label={`Fórmula de la celda ${selectedCell}`} value={formulas[selectedCell] ?? ""} disabled={!editableCells.includes(selectedCell)}
              onChange={(e) => setFormulas((prev) => ({ ...prev, [selectedCell]: e.target.value }))}
              placeholder={editableCells.includes(selectedCell) ? "Escribe la fórmula" : "Esta celda no se edita"}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-sm disabled:opacity-50" style={{ borderColor: "#217346", background: "var(--surface)", color: "var(--text)" }} />
          </div>

          {/* Cuadrícula */}
          <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <table className="w-full border-collapse text-center text-sm" aria-label="Hoja de cálculo simulada">
              <thead>
                <tr>
                  <th className="border px-1 py-1.5 text-xs" style={{ borderColor: "var(--border)", background: "#E7EFE9", width: 30 }} aria-label="Esquina"></th>
                  {cols.map((c) => <th key={c} className="border px-1 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)", background: selectedCell.startsWith(c) ? "#C6E7D2" : "#E7EFE9" }}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r}>
                    <th className="border px-1 py-1 text-xs font-bold" style={{ borderColor: "var(--border)", background: selectedCell === `${selectedCell[0]}${r}` || selectedCell.endsWith(String(r)) && r > 1 ? "#E7EFE9" : "#E7EFE9" }}>{r}</th>
                    {cols.map((c) => {
                      const addr = `${c}${r}`;
                      const editable = editableCells.includes(addr);
                      const isSel = selectedCell === addr;
                      const isHeader = r === 1;
                      return (
                        <td key={addr}>
                          <button type="button" aria-label={`Celda ${addr}${editable ? ", editable" : ""}: ${displayFor(addr) || "vacía"}`} onClick={() => setSelectedCell(addr)}
                            className="block h-10 w-full px-1 font-mono text-[13px]"
                            style={{
                              border: isSel ? "2px solid #217346" : "1px solid var(--border)",
                              background: editable ? "#FFF3B0" : isHeader ? "#F1F5F2" : "var(--surface)",
                              color: "var(--text)", fontWeight: isHeader ? 700 : 400, minHeight: 40,
                            }}>
                            {displayFor(addr)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs" style={{ color: "var(--dim)" }}>Las celdas amarillas son las que debes completar.</p>

          {/* Tareas prácticas */}
          <div className="mt-4 space-y-2">
            {selectedPractical.map((t, i) => {
              const f = (formulas[t.cell] ?? "").trim();
              return (
                <button key={t.cell} type="button" onClick={() => setSelectedCell(t.cell)} aria-label={`Ir a la tarea ${t.title}, celda ${t.cell}`}
                  className="w-full rounded-xl border px-3 py-3 text-left" style={{ background: "var(--surface)", borderColor: selectedCell === t.cell ? "#217346" : "var(--border)", borderWidth: selectedCell === t.cell ? 2 : 1 }}>
                  <p className="text-sm font-bold">{i + 1}. {t.title} <span className="ml-1 rounded-md px-1.5 py-0.5 font-mono text-xs text-white" style={{ background: "#217346" }}>{t.cell}</span> <span className="font-normal" style={{ color: "var(--dim)" }}>(1 punto)</span></p>
                  <p className="mt-0.5 text-sm" style={{ color: "var(--dim)" }}>{t.instruction(v)}</p>
                  {f && <p className="mt-1 font-mono text-xs" style={{ color: "var(--dim)" }}>{`Tu fórmula: ${f} → ${resultTextFor(t, f)}`}</p>}
                </button>
              );
            })}
          </div>
        </section>

        {/* TEORÍA */}
        <section className="mt-8" aria-label="Teoría de opción múltiple">
          <h2 className="text-xl font-extrabold">Parte 2 · Teoría</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{v.questions.length} preguntas de opción múltiple (1 punto cada una). El orden y las opciones son los de tu variante {v.code}.</p>
          <div className="mt-3 space-y-3">
            {v.questions.map((q, qi) => (
              <fieldset key={q.id} className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <p className="text-[15px] font-semibold leading-snug">{qi + 1}. {q.q}</p>
                <div className="mt-3 space-y-2" role="radiogroup" aria-label={`Opciones de la pregunta ${qi + 1}`}>
                  {q.options.map((opt, oi) => {
                    const selected = answers[q.id] === oi;
                    return (
                      <button key={oi} type="button" role="radio" aria-checked={selected} onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                        className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm"
                        style={{ borderColor: selected ? "#217346" : "var(--border)", background: selected ? "#EFF6F1" : "var(--bg)", borderWidth: selected ? 2 : 1, minHeight: 44 }}>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold" style={{ borderColor: selected ? "#217346" : "var(--border)", background: selected ? "#217346" : "transparent", color: selected ? "#fff" : "var(--dim)" }}>{String.fromCharCode(65 + oi)}</span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        <div className="mt-8 rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--dim)" }}>Al terminar se califica solo, en base a 30, y se guarda tu resultado con tus iniciales <strong style={{ color: "var(--text)" }}>{session.initials}</strong> y tu variante <strong style={{ color: "var(--text)" }}>{v.code}</strong>. Revisa: teoría {answeredCount}/{v.questions.length} respondidas, práctica {pracDone}/{v.practicalCells.length} fórmulas escritas.</p>
          <button type="button" onClick={finishExam} className="mt-3 w-full rounded-xl py-3.5 text-base font-bold text-white" style={{ background: "#217346" }}>Terminar y calificar mi examen</button>
        </div>
      </main>
    </div>
  );
}
