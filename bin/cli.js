#!/usr/bin/env node

import { program } from "commander";
import { generateApi } from "../src/generate.js";

program
    .option("--ts", "Generate api.ts with types")
    .option("--js", "Generate api.js for project made on JS")
    .option("--elysia", "Generate API for ElysiaJS")
    .option("--express", "Generate API for ExpressJS")
    .option("--nestjs", "Generate API for NestJS")
    .option("--fastify", "Generate API for Fastify")
    .option("--adonis", "Generate API for AdonisJS")
    .option("--koa", "Generate API for Koa.js")
    .option("--hono", "Generate API for Hono")
    .parse(process.argv);

const options = program.opts();

if (!options.ts && !options.js) {
    console.error("❌ Need to specify --ts or --js");
    process.exit(1);
}

const frameworks = ['elysia', 'express', 'nestjs', 'fastify', 'adonis', 'koa', 'hono'];
const selectedFrameworks = frameworks.filter(f => options[f]);

if (selectedFrameworks.length === 0) {
    console.error(`❌ Need to specify one of: ${frameworks.map(f => `--${f}`).join(', ')}`);
    process.exit(1);
}

if (selectedFrameworks.length > 1) {
    console.error(`❌ Cannot specify multiple frameworks: ${selectedFrameworks.join(', ')}`);
    process.exit(1);
}

const framework = selectedFrameworks[0];
const format = options.ts ? "ts" : "js";

generateApi(format, framework);