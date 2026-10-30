# ADR-0003: Drizzle ORM con SQL explícito

- **Estado:** Aceptada
- **Contexto:** la corrección de este servicio depende de primitivas específicas de PostgreSQL: `FOR UPDATE`, `SKIP LOCKED`, `ON CONFLICT DO NOTHING` y constraints únicas.

## Opciones

- **Prisma:** gran DX, pero `FOR UPDATE` / `SKIP LOCKED` requieren `$queryRaw`, y depende de binarios nativos del engine (más fricción en imágenes Alpine y en CI con red restringida).
- **TypeORM:** maduro, pero sus abstracciones (entities con estado, lazy relations) esconden qué SQL se ejecuta.
- **Drizzle:** query builder tipado, cercano a SQL, sin binarios. Las migraciones son archivos `.sql` versionados y revisables en el PR.

## Decisión

Drizzle + `node-postgres`. Las queries críticas (claim del outbox) se escriben en SQL plano con `sql\`\``, parametrizado.

## Consecuencias

- (+) Lo importante para la concurrencia se lee directamente en el código.
- (+) Imagen Docker más simple. Las migraciones se aplican con un script de Node.
- (−) Menos "magia": más código explícito en repositorios y servicios.
