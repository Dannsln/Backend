# SUNAT deployment checklist

Revision hecha el 2026-04-29 sobre el codigo local y la documentacion oficial de SUNAT.

## Referencias oficiales revisadas

- Guias y Manuales CPE: https://cpe.sunat.gob.pe/guias-y-manuales
- Factura Electronica 2.1: https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia%2Bxml%2Bfactura%2Bversion%202-1%2B1%2B0%20%282%29_0%20%282%29.pdf
- Certificado Digital SUNAT: https://cpe.sunat.gob.pe/certificado-digital
- Facturador SUNAT, envio y plazo: https://cpe.sunat.gob.pe/sistema_emision/facturador_sunat
- Servicio beta UBL 2.1: https://cpe.sunat.gob.pe/noticias/servicio-beta-para-realizar-pruebas-ubl-21
- Codigo de Producto SUNAT: https://cpe.sunat.gob.pe/informacion_general/codigoproducto

## Ya existe en el proyecto

- Generacion de XML UBL 2.1 para factura `01` y boleta `03`.
- Firma XML con certificado y llave PEM.
- Empaquetado ZIP y envio SOAP `sendBill` a beta o produccion segun `SUNAT_MODO`.
- Tablas base: `clientes`, `series_comprobantes`, `comprobantes`, `cola_sunat`.
- Registro de hash, XML firmado, CDR base64, respuesta/error SUNAT.
- UI de caja permite elegir ticket, factura o boleta.

## Pendiente critico antes de produccion

- Reemplazar los certificados de desarrollo en `MigracionRest/certs` por el certificado digital registrado en SUNAT. No subir llaves privadas reales al repositorio.
- Completar variables de empresa: `SUNAT_RUC` o `RUC_EMPRESA`, `SUNAT_RAZON_SOCIAL`, `SUNAT_NOMBRE_COMERCIAL`, `SUNAT_DIRECCION`, `SUNAT_UBIGEO`, `SUNAT_CODIGO_DOMICILIO`.
- Completar credenciales SOL: `SUNAT_USUARIO`, `SUNAT_CLAVE`, `SUNAT_MODO=PRODUCCION`, series reales `SUNAT_SERIE_FACTURA` y `SUNAT_SERIE_BOLETA`.
- Activar envio real: `SUNAT_AUTO_SEND=true` o conectar un worker/cron para procesar `cola_sunat`. Hoy la cola se crea, pero el worker `sunatQueueService (1).js` no esta conectado desde `server.js`.
- Validar XML antes de enviar contra XSD/XSL oficiales UBL 2.1 y contra las reglas de validacion CPE actualizadas al 24.04.2026.
- Parsear el CDR ZIP para guardar codigo, descripcion, notas y observaciones; hoy solo se guarda `cdr_base64` y un mensaje general.
- Diferenciar rechazo tributario definitivo, error temporal de comunicacion y observacion. Hoy un fallo de `sendBill` se marca como `RECHAZADO`.
- Implementar notas de credito/debito y anulaciones/bajas si el negocio necesitara corregir comprobantes emitidos.
- Definir y probar el tratamiento de boletas: envio individual vs resumen diario, segun la modalidad que usaran en produccion.
- Generar representacion impresa/PDF con datos completos del CPE, hash y QR si se entregara al cliente desde el sistema.
- Configurar consulta automatica de RUC/DNI (`RUC_API_URL`, `DNI_API_URL`, tokens) o bloquear emision si los datos no fueron verificados por caja.
- Ejecutar pruebas controladas en beta; SUNAT indica que beta es solo para probar estructura XML, no para carga masiva ni comprobantes reales.

## Variables esperadas para despliegue

```env
SUNAT_MODO=PRODUCCION
SUNAT_AUTO_SEND=true
SUNAT_RUC=
SUNAT_RAZON_SOCIAL=
SUNAT_NOMBRE_COMERCIAL=
SUNAT_DIRECCION=
SUNAT_UBIGEO=
SUNAT_CODIGO_DOMICILIO=
SUNAT_USUARIO=
SUNAT_CLAVE=
SUNAT_SERIE_FACTURA=F001
SUNAT_SERIE_BOLETA=B001
```

## Recomendacion de orden

1. Configurar certificado real y variables de empresa en un entorno de staging.
2. Agregar validador XSD/XSL y pruebas con XML de factura y boleta.
3. Conectar worker de `cola_sunat` y manejar reintentos sin marcar errores temporales como rechazo.
4. Parsear CDR y mostrar codigo/descripcion en reportes.
5. Cerrar notas, bajas/resumen diario y representacion impresa antes de pasar a `SUNAT_MODO=PRODUCCION`.
