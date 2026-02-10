import fs from "fs";
import path from "path";
import { glob } from "glob";

export async function generateApi(format, framework) {
    const files = await glob("**/*.{js,ts}", {
        ignore: ["node_modules/**", "dist/**", "api.js", "api.ts", "src/generate.js", "bin/cli.js", "tests/**"],
        cwd: process.cwd(),
        absolute: true,
    });

    let routes = [];

    for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const fileRoutes = extractRoutes(content, framework);
        if (fileRoutes.length > 0) {
            routes.push(...fileRoutes);
        }
    }

    if (routes.length === 0) {
        console.warn("⚠️ No routes found!");
    }

    const structure = buildStructure(routes);
    const content = generateContent(structure, format);

    const fileName = `api.${format}`;
    fs.writeFileSync(path.join(process.cwd(), fileName), content);

    console.log(`✅ ${fileName} generated with ${routes.length} routes for ${framework}!`);
}

function buildStructure(routes) {
    const structure = {};
    const usedNames = new Map(); // entity -> Set(names)

    routes.forEach(route => {
        const segments = route.path.split('/').filter(Boolean);
        const method = route.method.toLowerCase();

        let entity = segments[0] || 'root';

        // If first segment is a param, unlikely to be an entity, put in root
        if (entity.startsWith(':')) {
            entity = 'root';
        } else if (segments.length > 0) {
            segments.shift();
        } else {
            // It was just "/"
            entity = 'root';
        }

        let name = determineMethodName(method, segments, entity);

        if (!structure[entity]) {
            structure[entity] = [];
            usedNames.set(entity, new Set());
        }

        // Handle Collision
        let finalName = name;
        let counter = 1;
        const entityNames = usedNames.get(entity);

        // Try to append method if collision
        if (entityNames.has(finalName)) {
            finalName = `${name}${pascalCase(method)}`;
        }

        // If still collision, append params? Or strict counter as fallback (should be rare)
        while (entityNames.has(finalName)) {
            finalName = `${name}${counter}`; // Fallback, but much rarer now
            counter++;
        }

        entityNames.add(finalName);

        structure[entity].push({
            name: finalName,
            originalPath: route.path,
            method,
            params: extractParams(route.path) // Now we extract params here
        });
    });

    return structure;
}

function determineMethodName(method, segments, entity) {
    // segments here are the remainder after entity
    const isParam = (s) => s.startsWith(':');

    // 1. Root entity methods (e.g. GET /users)
    if (segments.length === 0) {
        if (method === 'get') return 'getAll';
        if (method === 'post') return 'create';
        if (method === 'put' || method === 'patch') return 'update'; // Bulk update?
        if (method === 'delete') return 'deleteAll'; // Rare but possible
        return method;
    }

    const last = segments[segments.length - 1];

    // 2. Ends with a param (e.g. GET /users/:id)
    if (isParam(last)) {
        const paramName = last.slice(1);
        // Use exact param name if it's descriptive, or entity name if it's generic 'id'
        const suffix = paramName === 'id' ? pascalCase(entity) : pascalCase(paramName);

        // Remove 's' from entity for singular naming if plural (simple heuristic)
        // actually 'getById' or 'getByUserId' is clearer.
        // User asked for "getByUserId" for "get_1" presumably for GET /users/:id

        let bySuffix = `By${suffix}`;
        if (paramName === 'id' && entity) {
            // Try to singularize entity for the ID name
            // e.g. users -> User
            let singular = entity;
            if (singular.endsWith('s')) singular = singular.slice(0, -1);
            bySuffix = `By${pascalCase(singular)}Id`;
        } else {
            bySuffix = `By${pascalCase(paramName)}`;
        }

        if (method === 'get') return `get${bySuffix}`;
        if (method === 'put' || method === 'patch') return `update${bySuffix}`;
        if (method === 'delete') return `delete${bySuffix}`;
        return `${method}${bySuffix}`;
    }

    // 3. Static path segments (e.g. /users/active, /auth/login)
    // Filter out params from the name chunks? Or include them?
    // /users/:id/avatar -> segments: [':id', 'avatar']

    // Check if it's a "verb-like" action at the end
    const actionVerbs = ['login', 'register', 'signup', 'signin', 'logout', 'search', 'find', 'upload', 'download', 'submit', 'verify', 'check', 'reset', 'forgot-password'];
    const lowerLast = last.toLowerCase();

    // If it's a known verb, just use it (e.g. login, search)
    if (actionVerbs.includes(lowerLast)) {
        // But if there are previous static segments, prepend them?
        // /items/search -> search
        // /items/advanced/search -> advancedSearch
        const staticSegments = segments.filter(s => !isParam(s));
        // Take strictly the static segments
        return camelCase(staticSegments.join('_'));
    }

    // General Case: verb + segments
    // /users/:id/avatar -> getAvatar, updateAvatar
    // /users/:id/settings/notifications -> getSettingsNotifications

    const staticParts = segments.filter(s => !isParam(s));
    const nameSuffix = staticParts.map(s => pascalCase(s)).join('');

    if (method === 'get') return `get${nameSuffix}`;
    if (method === 'post') return `create${nameSuffix}`;
    if (method === 'put' || method === 'patch') return `update${nameSuffix}`;
    if (method === 'delete') return `delete${nameSuffix}`;

    return `${method}${nameSuffix}`;
}

function pascalCase(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

function camelCase(str) {
    if (!str) return '';
    const pascal = pascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function formatName(segment) {
    return segment.replace(/:/g, '').replace(/-/g, '_');
}

function extractParams(path) {
    return (path.match(/:[a-zA-Z0-9_]+/g) || []).map(p => p.slice(1));
}

function generateContent(structure, format) {
    const isTs = format === 'ts';
    let lines = [];

    if (isTs) {
        lines.push(`import axios, { AxiosRequestConfig } from "axios";`);
        lines.push(``);
        lines.push(`// TODO: Define better types for responses and payloads`);
        lines.push(`export const api = {`);
    } else {
        lines.push(`import axios from "axios";`);
        lines.push(``);
        lines.push(`export const api = {`);
    }

    const entities = Object.keys(structure).sort();

    for (const entity of entities) {
        lines.push(`  ${entity}: {`);

        const methods = structure[entity];
        methods.forEach(m => {
            const originalParams = m.params || [];

            // Map params to better names: id -> userId, etc.
            const paramMapping = {};
            const displayParams = originalParams.map(p => {
                let newName = p;
                if (p === 'id') {
                    // Try to singularize entity for clarity
                    let singular = entity;
                    if (singular.endsWith('s')) singular = singular.slice(0, -1);
                    newName = `${camelCase(singular)}Id`;
                } else {
                    newName = camelCase(p);
                }
                paramMapping[p] = newName;
                return newName;
            });

            let args = [...displayParams];
            let axiosReqArgs = [];

            // Build URL string with mapped params
            let url = m.originalPath;
            originalParams.forEach(p => {
                const mapped = paramMapping[p];
                url = url.replace(`:${p}`, `\${${mapped}}`);
            });

            axiosReqArgs.push(`\`${url}\``);

            const hasBody = ['post', 'put', 'patch'].includes(m.method);

            if (hasBody) {
                args.push('data');
                axiosReqArgs.push('data');
            }

            args.push('config');
            axiosReqArgs.push('config'); // Axios config always fast

            let funcSignature = '';

            if (isTs) {
                const typedArgs = args.map(arg => {
                    if (arg === 'config') return 'config?: AxiosRequestConfig';
                    return `${arg}: any`; // TODO: Replace any
                }).join(', ');
                funcSignature = `(${typedArgs})`;
            } else {
                funcSignature = `(${args.join(', ')})`;
            }

            lines.push(`    // ${m.method.toUpperCase()} ${m.originalPath}`);
            lines.push(`    ${m.name}: ${funcSignature} => axios.${m.method}(${axiosReqArgs.join(', ')}),`);
        });

        lines.push(`  },`);
    }

    lines.push(`};`);
    return lines.join('\n');
}

function extractRoutes(content, framework) {
    const routes = [];
    const methods = ['get', 'post', 'put', 'delete', 'patch'];

    let regex;
    // Map frameworks to regex strategies
    const patterns = {
        express: `(?:app|router)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`,
        elysia: `(?<!app|router)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`,
        fastify: `(?:fastify|app)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`,
        adonis: `Route\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`,
        koa: `router\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`,
        hono: `(?:app|router)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`
    };

    if (framework === 'nestjs') {
        const controllerRegex = /@Controller\s*\(\s*(?:['"]([^'"]*)['"])?\s*\)/;
        const controllerMatch = controllerRegex.exec(content);
        const prefix = controllerMatch ? (controllerMatch[1] || '') : '';

        const methodRegex = new RegExp(`@(${methods.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join('|')})\\s*\\(\\s*(?:['"]([^'"]*)['"])?\\s*\\)`, 'g');
        let match;
        while ((match = methodRegex.exec(content)) !== null) {
            const method = match[1].toLowerCase();
            const pathPart = match[2] || '';
            let fullPath = '';

            if (prefix) fullPath += prefix.startsWith('/') ? prefix : `/${prefix}`;

            if (pathPart) {
                const cleanPathPart = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
                fullPath = fullPath ? (fullPath + cleanPathPart) : cleanPathPart;
            } else if (!prefix) {
                fullPath = '/';
            }

            if (!fullPath) fullPath = '/';
            routes.push({ method, path: fullPath.replace(/\/\//g, '/') });
        }
        return routes;
    }

    // Default Regex Selection
    if (framework === 'elysia') {
        regex = new RegExp(`(?<!app|router)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    } else if (framework === 'express') {
        regex = new RegExp(`(?:app|router)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    } else if (framework === 'fastify') {
        regex = new RegExp(`(?:fastify|app)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    } else if (framework === 'adonis') {
        regex = new RegExp(`Route\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    } else if (framework === 'koa') {
        regex = new RegExp(`router\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    } else if (framework === 'hono') {
        regex = new RegExp(`(?:app|router)\\.(?:${methods.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    }

    if (regex) {
        let match;
        while ((match = regex.exec(content)) !== null) {
            const fullMatch = match[0];
            const methodLine = fullMatch.split('(')[0];
            let method = methodLine.split('.').pop().trim();

            // Clean up method extraction for Elysia if needed (e.g. .get vs app.get)
            if (method.includes('(')) method = method.split('(')[0]; // Logic safety

            const path = match[1];
            routes.push({ method, path });
        }
    }

    return routes;
}