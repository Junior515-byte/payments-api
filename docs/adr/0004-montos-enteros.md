# ADR-0004: Montos como enteros en unidades mínimas

- **Estado:** Aceptada
- **Contexto:** `0.1 + 0.2 !== 0.3` en punto flotante. En pagos, un centavo de diferencia rompe conciliaciones.

## Decisión

- Los montos se guardan como `BIGINT` en la unidad mínima de la moneda: **PYG** sin decimales (150000 = Gs. 150.000), **USD** en centavos (1999 = US$ 19,99).
- La API recibe y devuelve enteros (`@IsInt()`); se rechaza `10.5`.
- La moneda es un enum explícito y viaja junto al monto. El webhook valida **monto y moneda**.

## Consecuencias

- (+) Aritmética exacta, sin librerías de decimales.
- (+) Coincide con cómo trabajan las pasarelas (Stripe y la mayoría usan minor units).
- (−) El frontend debe formatear (`Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' })`).
- (−) Se mapea a `number` en JS: es seguro hasta `Number.MAX_SAFE_INTEGER` (~9×10^15), validado en el DTO.
