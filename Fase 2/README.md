# Fase 2 · Desarrollo del Proyecto APT (FeriaPlace)

Estudiante: Bastian Reyes · Sección 010V · Docente: Reginaldo del Carmen Salinas Bruna

| Carpeta | Contenido |
|---|---|
| `Evidencias Grupales/` | 2.1 Diario de reflexión, 2.3 Formativa de avance y 2.4 Informe guía de desarrollo (con portada, abstract, conclusiones, reflexión, referencias y anexo del caso de uso) |
| `Evidencias Grupales/Evidencia_Modelo_Datos_y_Arquitectura_FeriaPlace.docx` | Modelo entidad-relación implementado, diccionario de datos, cambios respecto del modelo inicial y diagrama de arquitectura |
| `Evidencias Grupales/diagramas/` | Los dos diagramas en imagen (modelo ER y arquitectura) |
| `Evidencias Grupales/capturas-caso-de-uso/` | Capturas 01 a 21 del recorrido completo de la aplicación (06-10-2026): crear feria y croquis, registro y aprobación, solicitud, asignación, pago y salidas |
| `Evidencias Individuales/` | 2.2 Autoevaluación del informe de avance |
| `Fichas de avance/` | Fichas de avance 01 a 04 de las iteraciones |
| `Presentacion/` | Presentación de la Semana 10 (`Presentacion_Semana10_FeriaPlace_Bastian_Reyes`, en .pptx y .pdf) con el enfoque real, el avance y el caso de uso CU-01; también la presentación original de Fase 1 y la lista de cambios |

La aplicación está en `aplicacion-feriaplace/` (raíz del repositorio), con su guía de instalación en el README de esa carpeta.

Caso de uso de la Semana 10 (CU-01, detallado en el anexo del 2.4): una comerciante pide su cuenta y un puesto (ingreso), el administrador aprueba la cuenta y asigna el puesto con una transacción que impide asignarlo dos veces (procesamiento), y el sistema muestra el puesto ocupado, el monto y el pago en "Mis solicitudes", en "Pagos de puestos" y en el plano público (salida).

## Nota sobre los documentos de Fase 1

Los documentos de Fase 1 que se conservan como registro de esa etapa (el guion de la presentación, el modelo entidad-relación inicial de las semanas 3 y 4 y la Ficha de Avance 01) describen el planteamiento original para ferias libres, con reservas por fechas y tablas de sector, pago e historial. Durante el desarrollo, el proyecto se enfocó en ferias de temporada y se construyó con Node.js, Express y MySQL. Los cambios y sus motivos están en la sección 3 de `Evidencia_Modelo_Datos_y_Arquitectura_FeriaPlace.docx` y en la sección 3 del informe 2.4.
