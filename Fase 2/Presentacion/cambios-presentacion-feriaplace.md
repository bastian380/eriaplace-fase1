# Cambios para la presentación de FeriaPlace

Tu PDF muestra ferias libres y Django con PostgreSQL. La app real es para ferias de temporada y usa Node.js, Express y MySQL. Cambia solo estos textos en tu archivo original (PowerPoint o Canva). El resto de las diapositivas (metodología, etapas, plan, Gantt y competencias) sigue igual.

## Portada
- **Antes:** Aplicación web para gestión y comercialización de puestos en ferias libres.
- **Después:** Aplicación web para gestionar los puestos de ferias de temporada.

## 02 · Descripción del proyecto
- **Título:** FeriaPlace centraliza la administración de ferias de temporada
- **01:** Aplicación web para gestionar puestos en ferias de temporada, como las navideñas.
- **02:** El administrador crea cada feria con fechas, precio y un plano tipo croquis (puestos, escenario, baños y pasillos).
- **03:** Los comerciantes piden una cuenta, que el administrador aprueba, y luego solicitan un puesto y siguen su estado.
- **04:** Centraliza la información y reduce los errores de asignación de puestos.
- **Funcionalidades clave:** Plano · Mapa por comunas · Calendario · Solicitudes · Aprobación de comerciantes

## 03 · Fundamentación
- **Problema actual:** En las ferias de temporada, los puestos y el plano se llevan a mano o en medios dispersos.
- **Impacto:** Afecta a los organizadores y a los comerciantes que arriendan puestos.
- **Solución:** FeriaPlace reúne en una sola plataforma las ferias, su plano, los comerciantes y las solicitudes.
- **Pertinencia:** sin cambios.

## 04 · Objetivos
- **General:** Desarrollar una aplicación web que facilite la gestión de puestos en ferias de temporada.
- **01:** Diseñar un modelo de datos escalable e íntegro.
- **02:** Definir la arquitectura del frontend, el backend (API REST) y la base de datos.
- **03:** Implementar ferias con plano editable y un mapa de Santiago por comunas.
- **04:** Desarrollar solicitudes con validación de disponibilidad del puesto.
- **05:** Registrar un precio referencial por puesto y marcar a mano si fue pagado (sin pagos reales).
- **06:** Generar reportes de ocupación por feria.

## 06 · Stack tecnológico
- **Modelo ER:** PlantUML · MySQL
- **Desarrollo:** Node.js · Express · HTML/CSS/JavaScript · Git
- **Consultas:** MySQL · SQL (consola o MySQL Workbench)
- **Pruebas:** Navegador · pruebas de la API
- **Mapa de puestos:** Plano tipo croquis en JavaScript · Leaflet con mapa de comunas de Santiago
- Levantamiento, arquitectura y documentación: sin cambios.

## 02 · Funcionalidades clave (nota)
- Quita "Pagos (en desarrollo)": la app no tendrá pagos reales ni recaudación por ahora.

## Contacto (última diapositiva)
- Cambia el teléfono de ejemplo **+56 9 0000 0000** por el tuyo, o bórralo.
