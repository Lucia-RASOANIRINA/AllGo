import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { PERMISSION_KEY, PUBLIC_KEY } from '../decorators/auth.decorators';
import { Permission } from './permissions';

/**
 * **Test d'ossature** — §3.2 et §12.1.
 *
 * « Aucune route ne peut être publiée sans déclaration explicite — un test
 *   automatisé de l'ossature échoue si une route n'a pas de garde. »
 *
 * C'est le filet qui rend tenable la promesse de sécurité par défaut. Le web
 * exposait 30 routes d'administration protégées par la seule existence d'une
 * session ; ici, oublier une déclaration casse la CI avant la fusion.
 *
 * Une route doit porter SOIT `@Public()`, SOIT `@RequirePermission(…)`.
 * Jamais rien. Jamais les deux.
 */
describe('Ossature des routes — toute route déclare sa garde', () => {
  let app: INestApplication;
  let reflector: Reflector;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    reflector = app.get(Reflector);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Parcourt le routeur Express et relie chaque chemin à son gestionnaire Nest. */
  function collectHandlers(): Array<{ name: string; handler: (...args: unknown[]) => unknown }> {
    const container = (app as unknown as { container: { getModules(): Map<string, unknown> } })
      .container;
    const handlers: Array<{ name: string; handler: (...args: unknown[]) => unknown }> = [];

    for (const module of container.getModules().values()) {
      const controllers = (module as { controllers: Map<string, { instance: object }> })
        .controllers;
      for (const wrapper of controllers.values()) {
        const instance = wrapper.instance;
        if (!instance) continue;
        const prototype = Object.getPrototypeOf(instance);

        for (const method of Object.getOwnPropertyNames(prototype)) {
          if (method === 'constructor') continue;
          const handler = prototype[method];
          if (typeof handler !== 'function') continue;
          // Seules les méthodes portant un verbe HTTP sont des routes.
          if (Reflect.getMetadata('path', handler) === undefined) continue;
          handlers.push({ name: `${prototype.constructor.name}.${method}`, handler });
        }
      }
    }
    return handlers;
  }

  it('déclare au moins une route (le test lui-même doit être utile)', () => {
    expect(collectHandlers().length).toBeGreaterThan(0);
  });

  it('n’expose aucune route sans @Public() ni @RequirePermission()', () => {
    const undeclared = collectHandlers()
      .filter(({ handler }) => {
        const isPublic = reflector.get<boolean>(PUBLIC_KEY, handler);
        const permission = reflector.get<string>(PERMISSION_KEY, handler);
        return !isPublic && !permission;
      })
      .map(({ name }) => name);

    expect(undeclared).toEqual([]);
  });

  it('n’expose aucune route à la fois publique et soumise à permission', () => {
    const ambiguous = collectHandlers()
      .filter(({ handler }) => {
        return (
          reflector.get<boolean>(PUBLIC_KEY, handler) &&
          reflector.get<string>(PERMISSION_KEY, handler)
        );
      })
      .map(({ name }) => name);

    expect(ambiguous).toEqual([]);
  });

  it('n’exige que des permissions du catalogue de référence', () => {
    const known = new Set<string>(Object.values(Permission));

    const unknown = collectHandlers()
      .map(({ name, handler }) => ({
        name,
        permission: reflector.get<string>(PERMISSION_KEY, handler),
      }))
      .filter(({ permission }) => permission && !known.has(permission))
      .map(({ name, permission }) => `${name} → ${permission}`);

    expect(unknown).toEqual([]);
  });
});
