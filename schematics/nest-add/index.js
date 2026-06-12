"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.nestAdd = nestAdd;
const schematics_1 = require("@angular-devkit/schematics");
const tasks_1 = require("@angular-devkit/schematics/tasks");
const fs_1 = require("fs");
const path_1 = require("path");
const ts = __importStar(require("typescript"));
const PKG = '@open-rlb/nestjs-amqp';
function nestAdd(options) {
    return (0, schematics_1.chain)([
        addDependencies(options),
        createConfigFiles(options),
        modifyAppModule(options),
        options.gateway ? modifyMain(options) : (0, schematics_1.noop)(),
        options.skills ? copySkills() : (0, schematics_1.noop)(),
        options.skipInstall ? (0, schematics_1.noop)() : installDependencies(),
    ]);
}
// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------
function addDependencies(options) {
    return (tree, context) => {
        const path = 'package.json';
        if (!tree.exists(path)) {
            context.logger.warn('package.json not found; skipping dependency wiring.');
            return tree;
        }
        const pkg = JSON.parse(tree.read(path).toString('utf-8'));
        pkg.dependencies = pkg.dependencies || {};
        pkg.devDependencies = pkg.devDependencies || {};
        const deps = {
            [PKG]: pkg.dependencies[PKG] || 'latest',
            '@nestjs/config': '^4.0.0',
            'js-yaml': '^4.1.0',
        };
        if (options.gateway) {
            Object.assign(deps, {
                '@nestjs/axios': '^4.0.0',
                '@nestjs/platform-express': '^11.0.0',
                '@nestjs/platform-ws': '^11.0.0',
                '@nestjs/websockets': '^11.0.0',
            });
        }
        for (const [name, version] of Object.entries(deps)) {
            if (!pkg.dependencies[name])
                pkg.dependencies[name] = version;
        }
        if (!pkg.devDependencies['@types/js-yaml']) {
            pkg.devDependencies['@types/js-yaml'] = '^4.0.0';
        }
        tree.overwrite(path, JSON.stringify(pkg, null, 2) + '\n');
        context.logger.info('Added @open-rlb/nestjs-amqp dependencies to package.json');
        return tree;
    };
}
function installDependencies() {
    return (_tree, context) => {
        context.addTask(new tasks_1.NodePackageInstallTask());
        return _tree;
    };
}
// ---------------------------------------------------------------------------
// Config files (loader + config.yaml)
// ---------------------------------------------------------------------------
function createConfigFiles(options) {
    return (tree, context) => {
        const loaderPath = 'src/config/config.loader.ts';
        if (!tree.exists(loaderPath)) {
            tree.create(loaderPath, configLoaderContent(options.config));
            context.logger.info(`Created ${loaderPath}`);
        }
        if (!tree.exists(options.config)) {
            tree.create(options.config, configYamlContent(options));
            context.logger.info(`Created ${options.config}`);
        }
        else {
            context.logger.info(`${options.config} already exists; left untouched.`);
        }
        return tree;
    };
}
function configLoaderContent(configPath) {
    return `import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = '${configPath}';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
`;
}
function configYamlContent(options) {
    const base = `app:
  port: 3000
  host: 0.0.0.0
  environment: development

auth-providers: []

broker:
  uri: "amqp://guest:guest@localhost:5672/"
  defaultRpcTimeout: 10000
  defaultSubscribeErrorBehavior: ack
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: my-service
      credentials:
        mechanism: PLAIN
        username: guest
        password: guest
  exchanges:
    - name: my-ex
      type: direct
      createExchangeIfNotExists: true
      options: { durable: true }
  queues:
    - name: my-rpc-q
      exchange: my-ex
      routingKey: my.rpc
      createQueueIfNotExists: true
      options: { durable: true }

topics:
  - name: my-rpc
    mode: rpc
    queue: my-rpc-q
`;
    if (!options.gateway) {
        return base;
    }
    return (base +
        `
gateway:
  mode: gateway
  ws:
    heartbeatIntervalMs: 30000
    ***REMOVED*** Auth is declared per-event (events[].auth / requireAuth / roles / scopeClaim).
  paths:
    - name: ping
      method: GET
      path: /ping
      dataSource: query
      topic: my-rpc
      action: ping
      mode: rpc
  events: []
`);
}
// ---------------------------------------------------------------------------
// AppModule wiring
// ---------------------------------------------------------------------------
function modifyAppModule(options) {
    return (tree, context) => {
        const path = options.module;
        if (!tree.exists(path)) {
            context.logger.warn(`Module ${path} not found; add the wiring manually:\n${manualSnippet(options)}`);
            return tree;
        }
        const original = tree.read(path).toString('utf-8');
        if (original.includes('BrokerModule')) {
            context.logger.info(`${path} already imports BrokerModule; left untouched.`);
            return tree;
        }
        const importLines = buildImportLines(options).filter((l) => !original.includes(importSpecifier(l)));
        const entries = buildModuleEntries(options);
        try {
            const recorder = tree.beginUpdate(path);
            const source = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true);
            // 1) insert import statements after the last existing import
            let lastImportEnd = 0;
            source.statements.forEach((s) => {
                if (ts.isImportDeclaration(s))
                    lastImportEnd = s.getEnd();
            });
            if (importLines.length) {
                recorder.insertLeft(lastImportEnd, '\n' + importLines.join('\n'));
            }
            // 2) insert entries into the @Module({ imports: [...] }) array
            const arr = findModuleImportsArray(source);
            if (arr) {
                const hasElements = arr.elements.length > 0;
                const insertPos = arr.getStart() + 1; // right after '['
                recorder.insertRight(insertPos, '\n    ' + entries.join(',\n    ') + (hasElements ? ',' : '\n  '));
            }
            else {
                const obj = findModuleDecoratorObject(source);
                if (obj) {
                    const insertPos = obj.getStart() + 1; // after '{'
                    recorder.insertRight(insertPos, `\n  imports: [\n    ${entries.join(',\n    ')},\n  ],`);
                }
                else {
                    tree.commitUpdate(recorder);
                    context.logger.warn(`Could not locate @Module() in ${path}. Add manually:\n${manualSnippet(options)}`);
                    return tree;
                }
            }
            tree.commitUpdate(recorder);
            context.logger.info(`Wired @open-rlb/nestjs-amqp into ${path}`);
        }
        catch (e) {
            context.logger.warn(`Failed to edit ${path} (${e.message}). Add manually:\n${manualSnippet(options)}`);
        }
        return tree;
    };
}
function buildImportLines(options) {
    const brokerImports = options.gateway
        ? `import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, ProxyModule } from '${PKG}';`
        : `import { AppConfig, BrokerModule, BrokerTopic } from '${PKG}';`;
    const lines = [
        `import { ConfigModule, ConfigService } from '@nestjs/config';`,
        brokerImports,
        `import { RabbitMQConfig } from '${PKG}/amqp-lib/config/rabbitmq.config';`,
        `import { HandlerAuthConfig } from '${PKG}/modules/broker/config/handler-auth.config';`,
        `import yamlConfig from './config/config.loader';`,
    ];
    if (options.gateway) {
        lines.unshift(`import { HttpModule } from '@nestjs/axios';`);
    }
    return lines;
}
function importSpecifier(line) {
    const m = line.match(/from '([^']+)'/);
    return m ? m[1] : line;
}
function buildModuleEntries(options) {
    const factoryReturn = options.gateway
        ? `{ options, topics, appOptions, authOptions, gatewayOptions }`
        : `{ options, topics, appOptions, authOptions }`;
    const gatewayLine = options.gateway
        ? `\n        const gatewayOptions = config.get<GatewayConfig>('gateway');`
        : '';
    const broker = `BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const options = config.get<RabbitMQConfig>('broker');
        const topics = config.get<BrokerTopic[]>('topics');
        const appOptions = config.get<AppConfig>('app');
        const authOptions = config.get<HandlerAuthConfig[]>('auth-providers');${gatewayLine}
        return ${factoryReturn};
      },
    })`;
    const entries = [
        `ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] })`,
        broker,
    ];
    if (options.gateway) {
        entries.push('HttpModule', 'ProxyModule.forRoot([])');
    }
    return entries;
}
function findModuleImportsArray(source) {
    let result;
    const visit = (node) => {
        if (ts.isPropertyAssignment(node) &&
            node.name.getText() === 'imports' &&
            ts.isArrayLiteralExpression(node.initializer)) {
            result = node.initializer;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
}
function findModuleDecoratorObject(source) {
    let result;
    const visit = (node) => {
        if (ts.isCallExpression(node) &&
            node.expression.getText() === 'Module' &&
            node.arguments.length &&
            ts.isObjectLiteralExpression(node.arguments[0])) {
            result = node.arguments[0];
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
}
function manualSnippet(options) {
    return [...buildImportLines(options), '', '@Module({ imports: [', ...buildModuleEntries(options).map((e) => '  ' + e + ','), '] })'].join('\n');
}
// ---------------------------------------------------------------------------
// main.ts (gateway only): rawBody + WsAdapter
// ---------------------------------------------------------------------------
function modifyMain(options) {
    return (tree, context) => {
        const path = options.main;
        if (!tree.exists(path)) {
            context.logger.warn(`${path} not found; enable rawBody and the WS adapter manually.`);
            return tree;
        }
        let text = tree.read(path).toString('utf-8');
        if (text.includes('WsAdapter')) {
            context.logger.info(`${path} already configures the WS adapter; left untouched.`);
            return tree;
        }
        const recorder = tree.beginUpdate(path);
        // import WsAdapter after the last import
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        let lastImportEnd = 0;
        source.statements.forEach((s) => { if (ts.isImportDeclaration(s))
            lastImportEnd = s.getEnd(); });
        recorder.insertLeft(lastImportEnd, `\nimport { WsAdapter } from '@nestjs/platform-ws';`);
        // ensure rawBody and add the adapter right after NestFactory.create(...)
        const createMatch = text.match(/const\s+(\w+)\s*=\s*await\s+NestFactory\.create\(\s*([A-Za-z0-9_]+)\s*(,\s*\{[^}]*\})?\s*\)\s*;?/);
        if (createMatch) {
            const appVar = createMatch[1];
            const moduleArg = createMatch[2];
            const replacement = `const ${appVar} = await NestFactory.create(${moduleArg}, { rawBody: true });`;
            const start = text.indexOf(createMatch[0]);
            recorder.remove(start, createMatch[0].length);
            recorder.insertRight(start, `${replacement}\n  ${appVar}.useWebSocketAdapter(new WsAdapter(${appVar}));`);
        }
        else {
            context.logger.warn(`Could not find NestFactory.create() in ${path}; add { rawBody: true } and app.useWebSocketAdapter(new WsAdapter(app)) manually.`);
        }
        tree.commitUpdate(recorder);
        context.logger.info(`Configured rawBody + WS adapter in ${path}`);
        return tree;
    };
}
// ---------------------------------------------------------------------------
// Claude skills
// ---------------------------------------------------------------------------
function copySkills() {
    return (tree, context) => {
        const skillsRoot = (0, path_1.join)(__dirname, 'skills');
        let copied = 0;
        const walk = (absDir, relDir) => {
            let entries;
            try {
                entries = (0, fs_1.readdirSync)(absDir);
            }
            catch {
                return;
            }
            for (const entry of entries) {
                const abs = (0, path_1.join)(absDir, entry);
                const rel = relDir ? `${relDir}/${entry}` : entry;
                if ((0, fs_1.statSync)(abs).isDirectory()) {
                    walk(abs, rel);
                }
                else {
                    const target = `.claude/skills/${rel}`;
                    const content = (0, fs_1.readFileSync)(abs);
                    if (tree.exists(target)) {
                        tree.overwrite(target, content);
                    }
                    else {
                        tree.create(target, content);
                    }
                    copied++;
                }
            }
        };
        walk(skillsRoot, '');
        if (copied)
            context.logger.info(`Copied ${copied} Claude skill file(s) into .claude/skills`);
        else
            context.logger.warn('No bundled skills found to copy.');
        return tree;
    };
}
