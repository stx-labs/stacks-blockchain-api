import Fastify from 'fastify';
import { TSchema, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import FastifySwagger from '@fastify/swagger';
import { writeFileSync } from 'fs';
import { OpenApiSchemaOptions } from './api/schemas/openapi.js';
import { StacksApiRoutes } from './api/init.js';
import { ErrorResponseSchema } from './api/schemas/v1/responses/responses.js';

/**
 * Generates `openapi.yaml` based on current Swagger definitions.
 */
async function generateOpenApiFiles() {
  const fastify = Fastify({
    trustProxy: true,
    logger: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  fastify.addHook(
    'onRoute',
    (route: {
      schema?: { response: Record<string | number, TSchema>; deprecated?: boolean; hide?: boolean };
    }) => {
      // Exclude deprecated endpoints from the generated spec entirely
      // (`@fastify/swagger` omits any route whose schema is marked `hide`).
      if (route.schema?.deprecated) {
        route.schema.hide = true;
        return;
      }
      // If a response schema is defined but lacks a '4xx' response, add it
      if (route.schema?.response && !route.schema?.response['4xx']) {
        route.schema.response['4xx'] = ErrorResponseSchema;
      }
    }
  );

  await fastify.register(FastifySwagger, OpenApiSchemaOptions);
  await fastify.register(StacksApiRoutes);
  await fastify.ready();
  writeFileSync('./openapi.yaml', fastify.swagger({ yaml: true }));
  await fastify.close();
}

void generateOpenApiFiles();
