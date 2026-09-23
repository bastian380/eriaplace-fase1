# Guion de presentación — FeriaPlace
### Proyecto APT — Fase 1: Definición de Proyecto
*(Duración estimada: 7-8 minutos. Ajusta según el tiempo que te asignen.)*

---

## 1. Apertura (30 seg)

> "Buenos días/tardes. Mi nombre es Bastian Reyes, estudiante de Ingeniería en Informática, y hoy les voy a presentar mi propuesta de Proyecto APT: **FeriaPlace**, un sistema de gestión de puestos para ferias libres."

*(Mira a la audiencia, no leas la pantalla. Habla con calma, no apurado.)*

---

## 2. El problema (1 min)

> "La idea nace de un problema muy concreto y común en muchas municipalidades: **la administración de ferias libres se hace hoy mediante planillas o registros manuales, poco centralizados**. Esto genera varios problemas: no hay claridad sobre qué puestos están disponibles, es difícil llevar un historial de quién ha ocupado cada puesto, y no existe un canal claro para que un comerciante solicite un espacio."

> "Esto afecta a dos grupos principalmente: a los **administradores de la feria**, que deben controlar la ocupación y disponibilidad manualmente, y a los **comerciantes**, que no tienen un medio digital para consultar o reservar un puesto."

---

## 3. La solución (1 min)

> "FeriaPlace es una aplicación web que centraliza toda esta gestión. Permite a un administrador **crear una feria, organizarla en sectores y puestos**, y visualizar su distribución. Los comerciantes pueden **registrarse, consultar puestos disponibles, solicitar una reserva y pagar el arriendo**. Y el público general puede consultar qué ferias existen y qué comerciantes participan."

*(Si tienes el diagrama de arquitectura o el mockup del mapa, muéstralo aquí.)*

> "El sistema contempla cuatro pilares tecnológicos: aplicación web, base de datos, servicios en la nube, y una API para integración de pagos."

---

## 4. Relación con mi perfil e intereses (1 min)

> "Elegí este proyecto porque se alinea directamente con mis intereses profesionales: el **desarrollo de software** y la **gestión de bases de datos**. Además, me permite aplicar cinco competencias específicas de mi perfil de egreso:"

*(Lee cada una — tenlas memorizadas o en una tarjeta de apoyo, no las leas palabra por palabra de la pantalla)*

1. Ofrecer propuestas de solución informática según los requerimientos de la organización.
2. Construir modelos de datos escalables.
3. Construir el modelo arquitectónico de una solución sistémica.
4. Desarrollar una solución de software con buenas prácticas.
5. Programar consultas o rutinas para manipular información de una base de datos.

> "Estas competencias no son solo teóricas: cada una tiene una evidencia concreta que ya está en desarrollo, como les mostraré a continuación."

---

## 5. Objetivos (45 seg)

> "El objetivo general es: **desarrollar una aplicación web que permita gestionar y comercializar puestos en ferias libres**, facilitando tanto la administración como la reserva de espacios."

> "De ahí se desprenden seis objetivos específicos, entre ellos: diseñar un modelo de datos escalable, construir la arquitectura del sistema, implementar el módulo de reservas con validación automática de disponibilidad, y generar reportes administrativos."

*(No leas los 6 objetivos completos en voz alta si el tiempo es corto — menciona 2 o 3 como ejemplo y di "el resto está detallado en el informe".)*

---

## 6. Modelo de datos — lo más avanzado hasta ahora (1.5 min)

> "Quiero detenerme un momento en la parte que más he trabajado hasta ahora: el **modelo entidad-relación**."

*(Aquí muestra el diagrama ER — este es tu momento más fuerte, tienes evidencia concreta)*

> "El punto clave de este diseño es que **un puesto no se asocia directamente a un comerciante**. En cambio, toda ocupación pasa por una tabla central llamada RESERVA, que registra fechas de inicio, fin y un estado: pendiente, aprobada, activa, finalizada, rechazada o cancelada."

> "¿Por qué es importante esto? Porque si un puesto cambia de comerciante, **no se pierde el historial** — simplemente queda una reserva más en el registro. Además, esto me permite resolver un problema crítico: **evitar que dos comerciantes reserven el mismo puesto en fechas que se cruzan**, mediante una consulta SQL que verifica solapamiento de fechas antes de aprobar cualquier solicitud."

> "Ya validé este modelo contra seis casos de prueba reales: reserva simultánea, cancelación, liberación del puesto, cambio de comerciante y consulta de historial — y el modelo los resuelve todos correctamente."

---

## 7. Factibilidad y plan de trabajo (1 min)

> "En cuanto a la factibilidad: cuento con **4 horas diarias de dedicación** durante los dos meses centrales del desarrollo, lo que equivale a más de 200 horas de trabajo efectivo. El plan de trabajo está organizado en las 18 semanas de la asignatura, divididas en tres fases: definición del proyecto, desarrollo, y cierre."

> "La principal dificultad que anticipo está en dos partes técnicas puntuales: el diseño de la base de datos —que ya está en proceso de validación, como mostré recién— y la construcción del mapa visual interactivo, para lo cual comenzaré con una versión simplificada en formato de grilla."

---

## 8. Cierre (30 seg)

> "En resumen: FeriaPlace es un proyecto acotado, factible dentro del plazo, que me permite aplicar directamente las competencias de mi perfil de egreso, y que ya cuenta con un primer avance concreto y validado: el modelo de datos. Muchas gracias, quedo atento a sus preguntas."

---

## Notas para el momento de preguntas

El indicador 11 de tu rúbrica evalúa que **respondas evidenciando manejo de la información** — no solo que leas bien. Prepárate para preguntas como:

- **"¿Por qué eligiste hacerlo individual?"** → Ten lista una respuesta breve y segura (ver el correo que enviaste al jefe de carrera como referencia de tus argumentos).
- **"¿Qué pasa si un comerciante no paga?"** → Puedes responder: "Se contempla en el estado de la reserva; una reserva sin pago registrado no pasa a estado ACTIVA."
- **"¿Cómo evitas que dos personas reserven el mismo puesto al mismo tiempo (concurrencia)?"** → "La validación se hace a nivel de consulta antes de aprobar; en una siguiente etapa se puede reforzar con una transacción de base de datos que bloquee el registro durante la verificación."
- **"¿Qué tecnología vas a usar?"** → Ten una respuesta clara aunque no esté 100% decidida (menciona las que evaluaste: Node/Express, Laravel, etc.).

**Consejo general:** practica este guion en voz alta al menos 2-3 veces cronometrando el tiempo, y evita memorizarlo palabra por palabra — es mejor tener las ideas claras y decirlas con tus propias palabras el día de la presentación.
