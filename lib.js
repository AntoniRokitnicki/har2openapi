"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEndpoints = exports.postProduction = exports.parseHarFileIntoIndividualFiles = exports.updateXcode = exports.mergeFiles = exports.generateSchema = exports.generateSpec = exports.generateSamples = void 0;
const openapi_v3_types_1 = require("@loopback/openapi-v3-types");
const merge = require("deepmerge");
const fs_1 = require("fs");
const YAML = require("js-yaml");
const parseJson = require("parse-json");
const pluralize = require("pluralize");
const process_1 = require("process");
const sortJson = require("sort-json");
const quicktype_core_1 = require("quicktype-core");
const deref = require("json-schema-deref-sync");
const toOpenApiSchema = require("@openapi-contrib/json-schema-to-openapi-schema");
const recursive = require("recursive-readdir");
const pad = (m, width, z = '0') => {
    const n = m.toString();
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
};
function quicktypeJSON(targetLanguage, typeName, sampleArray) {
    return __awaiter(this, void 0, void 0, function* () {
        const jsonInput = quicktype_core_1.jsonInputForTargetLanguage(targetLanguage);
        yield jsonInput.addSource({
            name: typeName,
            samples: sampleArray,
        });
        const inputData = new quicktype_core_1.InputData();
        inputData.addInput(jsonInput);
        const result = yield quicktype_core_1.quicktype({
            inputData,
            lang: targetLanguage,
            alphabetizeProperties: true,
            allPropertiesOptional: true,
            ignoreJsonRefs: true
        });
        const returnJSON = JSON.parse(result.lines.join("\n"));
        return deref(returnJSON);
    });
}
const addMethod = (method, filteredUrl, originalPath, methodList, spec, config) => {
    let operationId = filteredUrl.replace(/(^\/|\/$|{|})/g, "").replace(/\//g, "-");
    operationId = `${method}-${operationId}`;
    const summary = deriveSummary(method, filteredUrl);
    const tag = deriveTag(filteredUrl, config);
    spec.paths[filteredUrl][method] = {
        operationId,
        summary,
        description: "",
        parameters: [],
        responses: {},
        tags: [tag],
        meta: {
            originalPath,
            element: ""
        }
    };
    methodList.push(`${tag}\t${filteredUrl}\t${method}\t${summary}`);
};
const addPath = (filteredUrl, spec) => {
    const parameters = [];
    const parameterList = filteredUrl.match(/{.*?}/g);
    if (parameterList) {
        parameterList.forEach(parameter => {
            const variable = parameter.replace(/[{}]/g, '');
            const variableType = variable.replace(/_id/, '');
            parameters.push({
                "description": `Unique ID of the ${variableType} you are working with`,
                "in": "path",
                "name": variable,
                "required": true,
                "schema": {
                    "type": "string"
                }
            });
        });
    }
    spec.paths[filteredUrl] = {
        parameters
    };
};
const addQueryStringParams = (specMethod, harParams) => {
    const methodQueryParameters = [];
    specMethod.parameters.forEach(param => {
        if (param.in === 'query')
            methodQueryParameters.push(param.name);
    });
    harParams.forEach(param => {
        if (!methodQueryParameters.includes(param.name)) {
            specMethod.parameters.push({
                schema: {
                    type: "string",
                    default: param.value,
                    example: param.value
                },
                in: "query",
                name: param.name,
                description: param.name
            });
        }
    });
};
const addResponse = (status, method, specPath) => {
    switch (status) {
        case 200:
            switch (method) {
                case 'get':
                    specPath.responses["200"] = { "description": "Success" };
                    break;
                case 'delete':
                    specPath.responses["200"] = { "description": "Item deleted" };
                    break;
                case 'patch':
                    specPath.responses["200"] = { "description": "Item updated" };
                    break;
                case 'post':
                    specPath.responses["200"] = { "description": "Item created" };
                    break;
            }
            break;
        case 201:
            switch (method) {
                case 'post':
                    specPath.responses["201"] = { "description": "Item created" };
                    break;
            }
            break;
        case 202:
            switch (method) {
                case 'post':
                    specPath.responses["202"] = { "description": "Item created" };
                    break;
            }
            break;
        case 204:
            switch (method) {
                case 'get':
                    specPath.responses["204"] = { "description": "Success" };
                    break;
                case 'delete':
                    specPath.responses["204"] = { "description": "Item deleted" };
                    break;
                case 'patch':
                case 'put':
                    specPath.responses["204"] = { "description": "Item updated" };
                    break;
                case 'post':
                    specPath.responses["202"] = { "description": "Item created" };
                    break;
            }
            break;
        case 400:
            switch (method) {
                case 'delete':
                    specPath.responses["400"] = { "description": "Deletion failed - item in use" };
                    break;
                default:
                    specPath.responses["400"] = { "description": "Bad request" };
            }
            break;
        case 401:
            specPath.responses["401"] = { "description": "Unauthorized" };
            break;
        case 404:
            specPath.responses["404"] = { "description": "Item not found" };
            break;
        case 405:
            specPath.responses["405"] = { "description": "Not allowed" };
            break;
    }
};
const capitalize = (s) => {
    if (typeof s !== 'string')
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
};
const combineMerge = (target, source, options) => {
    const destination = target.slice();
    source.forEach((item, index) => {
        if (typeof destination[index] === 'undefined') {
            destination[index] = options.cloneUnlessOtherwiseSpecified(item, options);
        }
        else if (options.isMergeableObject(item)) {
            destination[index] = merge(target[index], item, options);
        }
        else if (target.indexOf(item) === -1) {
            destination.push(item);
        }
    });
    return destination;
};
const createXcodeSamples = (spec) => {
    Object.keys(spec.paths).forEach(path => {
        Object.keys(spec.paths[path]).forEach(lMethod => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
            if (lMethod === 'parameters')
                return;
            const method = spec.paths[path][lMethod];
            const samples = [];
            const scrubbedPath = path
                .replace(/{dataset_id}/g, '0001a')
                .replace(/{variable_id}/g, '0001b')
                .replace(/{user_id}/g, '0001c')
                .replace(/{subvariable_id}/g, '0001d')
                .replace(/{folder_id}/g, '0001e')
                .replace(/{slide_id}/g, '0001f')
                .replace(/{deck_id}/g, '0001g')
                .replace(/{analysis_id}/g, '0001h')
                .replace(/{tag_name}/g, '0001i')
                .replace(/{project_id}/g, '0001j')
                .replace(/{integration_id}/g, '0001k')
                .replace(/{integration_partner}/g, '0001l')
                .replace(/{team_id}/g, '0001m')
                .replace(/{savepoint_id}/g, '0001n')
                .replace(/{script_id}/g, '0001o')
                .replace(/{multitable_id}/g, '0001p')
                .replace(/{subdomain}/g, '0001q')
                .replace(/{account_id}/g, '0001r')
                .replace(/{filter_id}/g, '0001s')
                .replace(/{geodata_id}/g, '0001t')
                .replace(/{task_id}/g, '0001u')
                .replace(/{flag_id}/g, '0001v')
                .replace(/{source_id}/g, '0001w')
                .replace(/{batch_id}/g, '0001x')
                .replace(/{action_hash}/g, '0001y')
                .replace(/{boxdata_id}/g, '0001z')
                .replace(/{datasetName}/g, '0001aa')
                .replace(/{format}/g, '0001ab')
                .replace(/{dashboard_id}/g, '0001ac');
            if (!method['x-code-samples'])
                method['x-code-samples'] = [];
            let data;
            const originalPath = `https://app.crunch.io/api${((_a = method === null || method === void 0 ? void 0 : method.meta) === null || _a === void 0 ? void 0 : _a.originalPath) || scrubbedPath}`;
            let curlCode = `curl -X ${lMethod.toUpperCase()} ${originalPath}`;
            if (!originalPath.includes('public'))
                curlCode += ` \\\n  -H 'Authorization: Bearer 598d9e1105'`;
            const examples = (_d = (_c = (_b = method.requestBody) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c["application/json"]) === null || _d === void 0 ? void 0 : _d.examples;
            if (examples) {
                const exampleList = Object.keys(examples);
                if (exampleList.length) {
                    const firstExample = exampleList[0];
                    data = (_j = (_h = (_g = (_f = (_e = method.requestBody) === null || _e === void 0 ? void 0 : _e.content) === null || _f === void 0 ? void 0 : _f["application/json"]) === null || _g === void 0 ? void 0 : _g.examples) === null || _h === void 0 ? void 0 : _h[firstExample]) === null || _j === void 0 ? void 0 : _j.value;
                }
            }
            if (data) {
                curlCode += ` \\\n  -H 'Content-Type: application/json'`;
                curlCode += ` -d '\n${JSON.stringify(data, null, 2)}\n'`;
            }
            let found = false;
            const shellCodeSample = {
                lang: "SHELL",
                source: replaceApos(curlCode),
                syntaxLang: "bash"
            };
            for (let codeSample in method['x-code-samples']) {
                if (method['x-code-samples'][codeSample].lang == "SHELL") {
                    found = true;
                    method['x-code-samples'][codeSample] = shellCodeSample;
                }
            }
            if (!found) {
                method['x-code-samples'].push(shellCodeSample);
            }
            const operationVariable = method.operationId.split('-').map((part, index) => index ? capitalize(part) : part).join('').trim();
            let jsCode = [];
            let urlVar = "";
            if (originalPath.includes("?")) {
                const pieces = originalPath.split('?');
                urlVar = operationVariable + 'URL';
                jsCode.push(`const ${urlVar} = new URL('${pieces[0]}')`);
                jsCode.push(`${urlVar}.search = new URLSearchParams({`);
                pieces[1].split('&').forEach(keyval => {
                    const smallPieces = keyval.split('=');
                    jsCode.push(`  ${smallPieces[0]}: '${smallPieces[1]}'`);
                });
                jsCode.push(`})`);
            }
            jsCode.push(`const ${operationVariable} = await fetch(`);
            jsCode.push(`  ${urlVar || "'" + originalPath + "'"}, {`);
            jsCode.push(`   method: '${lMethod.toUpperCase()}',`);
            if (!originalPath.includes('public')) {
                jsCode.push(`   headers: {`);
                jsCode.push(`    'Authorization': 'Bearer 598d9e1105'`);
                if (data) {
                    jsCode[jsCode.length - 1] += ',';
                    jsCode.push(`    'Content-Type': 'application/json'`);
                }
                jsCode.push(`   }`);
            }
            if (data) {
                jsCode[jsCode.length - 1] += ',';
                const lines = `   body: JSON.stringify(${JSON.stringify(data, null, 2)})`.replace(/\n/g, '\n   ').split('\n');
                jsCode = jsCode.concat(lines);
            }
            jsCode.push(` })`);
            const firstResponse = Object.keys(method.responses)[0] || "";
            if ((_q = (_p = (_o = (_m = (_l = (_k = method.responses) === null || _k === void 0 ? void 0 : _k[firstResponse]) === null || _l === void 0 ? void 0 : _l.content) === null || _m === void 0 ? void 0 : _m["application/json"]) === null || _o === void 0 ? void 0 : _o.examples) === null || _p === void 0 ? void 0 : _p['example-1']) === null || _q === void 0 ? void 0 : _q.value) {
                jsCode.push(` .then(response => response.json())`);
                switch ((_x = (_w = (_v = (_u = (_t = (_s = (_r = method.responses) === null || _r === void 0 ? void 0 : _r[firstResponse]) === null || _s === void 0 ? void 0 : _s.content) === null || _t === void 0 ? void 0 : _t["application/json"]) === null || _u === void 0 ? void 0 : _u.examples) === null || _v === void 0 ? void 0 : _v['example-1']) === null || _w === void 0 ? void 0 : _w.value) === null || _x === void 0 ? void 0 : _x.element) {
                    case 'shoji:catalog':
                        jsCode.push(` .then(jsonResponse => jsonResponse.index)`);
                        break;
                    case 'shoji:entity':
                        jsCode.push(` .then(jsonResponse => jsonResponse.body)`);
                        break;
                    case 'shoji:view':
                        jsCode.push(` .then(jsonResponse => jsonResponse.value)`);
                        break;
                }
            }
            found = false;
            const jsCodeSample = {
                "lang": "JAVASCRIPT",
                "source": replaceApos(jsCode.join('\n')),
                "syntaxLang": "javascript"
            };
            for (let codeSample in method['x-code-samples']) {
                if (method['x-code-samples'][codeSample].lang == "JAVASCRIPT") {
                    found = true;
                    method['x-code-samples'][codeSample] = jsCodeSample;
                }
            }
            if (!found) {
                method['x-code-samples'].push(jsCodeSample);
            }
        });
    });
};
const deriveSummary = (method, path) => {
    const pathParts = path.split('/');
    const lastParam = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";
    const lastLastParam = pathParts.length > 3 ? pathParts[pathParts.length - 4] : "";
    const obj = lastParam.includes("_id") ? lastParam.replace(/[{}]|_id/g, "") : "";
    switch (lastParam) {
        case 'login':
            return "Log in";
        case 'logout':
            return "Log out";
    }
    if (obj) {
        switch (method) {
            case 'get':
                return `${capitalize(obj)} details`;
            case 'post':
                return `Create ${obj}`;
            case 'patch':
            case 'put':
                return `Update ${obj}`;
            case 'delete':
                return `Delete ${obj}`;
        }
    }
    switch (method) {
        case 'get':
            return `List ${pluralize(lastLastParam, 1)}${lastLastParam ? " " : ""}${pluralize(lastParam)}`;
        case 'post':
            return `Create ${pluralize(lastLastParam, 1)}${lastLastParam ? " " : ""}${pluralize(lastParam, 1)}`;
        case 'put':
        case 'patch':
            return `Update ${pluralize(lastLastParam, 1)}${lastLastParam ? " " : ""}${pluralize(lastParam)}`;
        case 'delete':
            return `Delete ${pluralize(lastLastParam, 1)}${lastLastParam ? " " : ""}${pluralize(lastParam)}`;
    }
    return "SUMMARY";
};
const deriveTag = (path, config) => {
    for (const item of config.tags) {
        if (path.includes(item[0]))
            return item.length > 1 ? item[1] : capitalize(item[0]);
    }
    return "Miscellaneous";
};
const filterUrl = (config, inputUrl) => {
    let filteredUrl = inputUrl;
    for (const key in config.pathReplace) {
        const re = new RegExp(key, 'g');
        filteredUrl = filteredUrl.replace(re, config.pathReplace[key]);
    }
    return filteredUrl;
};
const generateSamples = (spec, outputFilename) => {
    createXcodeSamples(spec);
    Object.keys(spec.paths).forEach(path => {
        Object.keys(spec.paths[path]).forEach(lMethod => {
            delete spec.paths[path][lMethod]['meta'];
        });
    });
    const stripedSpec = JSON.parse(JSON.stringify(spec)
        .replace(/stable\.crunch\.io/g, 'app.crunch.io')
        .replace(/A\$dfasdfasdf/g, 'abcdef')
        .replace(/captain@crunch.io/g, 'user@crunch.io'));
    fs_1.writeFileSync(outputFilename, JSON.stringify(stripedSpec, null, 2));
    fs_1.writeFileSync(outputFilename + '.yaml', YAML.dump(stripedSpec));
    console.log(`${outputFilename} created`);
};
exports.generateSamples = generateSamples;
const generateSpec = (inputFilenames, outputFilename, config) => {
    const inputHars = inputFilenames.map(filename => parseHarFile(filename));
    const har = merge.all(inputHars);
    console.log(`Network requests found in har file(s): ${har.log.entries.length}`);
    const spec = openapi_v3_types_1.createEmptyApiSpec();
    const methodList = [];
    har.log.entries.sort().forEach(item => {
        var _a, _b, _c;
        if (!item.request.url.includes(config.apiBasePath)) {
            if (item.request.url.includes('api') || ((_c = (_b = (_a = item.response) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b.mimeType) === null || _c === void 0 ? void 0 : _c.includes('application/json'))) {
                console.log('apiBasePath mismatch', item.request.url);
            }
            return;
        }
        let filteredUrl = filterUrl(config, item.request.url);
        if (!filteredUrl)
            return;
        if (!spec.paths[filteredUrl])
            addPath(filteredUrl, spec);
        const method = item.request.method.toLowerCase();
        if (!spec.paths[filteredUrl][method])
            addMethod(method, filteredUrl, item.request.url, methodList, spec, config);
        const specMethod = spec.paths[filteredUrl][method];
        specMethod.meta.originalPath = item.request.url;
        addResponse(item.response.status, method, specMethod);
        addQueryStringParams(specMethod, item.request.queryString);
        if (item.request.bodySize > 0 && item.response.status < 400)
            mergeRequestExample(specMethod, item.request.postData);
        if (item.response.bodySize > 0)
            mergeResponseExample(specMethod, item.response.status.toString(), item.response.content, method, filteredUrl);
    });
    spec.paths = sortJson(spec.paths, { depth: 200 });
    let specString = JSON.stringify(spec);
    for (const key in config.replace) {
        const re = new RegExp(key, 'g');
        specString = specString.replace(re, config.replace[key]);
    }
    const outputSpec = parseJson(specString);
    fs_1.writeFileSync(outputFilename, JSON.stringify(outputSpec, null, 2));
    fs_1.writeFileSync(outputFilename + '.yaml', YAML.dump(outputSpec));
    writeExamples(outputSpec);
    fs_1.writeFileSync('output/pathList.txt', Object.keys(outputSpec.paths).join('\n'));
    fs_1.writeFileSync('output/methodList.txt', methodList.sort().join('\n'));
    console.log('Paths created:', Object.keys(outputSpec.paths).length);
    console.log('Operations created:', methodList.length);
};
exports.generateSpec = generateSpec;
const mergeFiles = (masterFilename, toMergeFilename, outputFilename) => {
    const master = parseJsonFile(masterFilename);
    const toMerge = parseJsonFile(toMergeFilename);
    for (const path in toMerge.paths) {
        if (!master.paths[path]) {
            master.paths[path] = toMerge.paths[path];
        }
        else {
            for (const method in toMerge.paths[path]) {
                if (!master.paths[path][method])
                    master.paths[path][method] = toMerge.paths[path][method];
            }
        }
    }
    master.paths = sortJson(master.paths, { depth: 200 });
    fs_1.writeFileSync(outputFilename, JSON.stringify(master, null, 2));
    fs_1.writeFileSync(outputFilename + '.yaml', YAML.safeDump(master));
    console.log(`${outputFilename} created`);
};
exports.mergeFiles = mergeFiles;
const mergeRequestExample = (specMethod, postData) => {
    if (postData.text) {
        try {
            const data = JSON.parse(postData.encoding == 'base64' ? Buffer.from(postData.text, 'base64').toString() : postData.text);
            if (!specMethod['requestBody']) {
                specMethod['requestBody'] = {
                    "content": {
                        "application/json": {
                            "examples": {
                                "example-0001": {
                                    value: {}
                                }
                            },
                            "schema": {
                                "properties": {},
                                "type": "object"
                            }
                        }
                    }
                };
                specMethod.requestBody.content["application/json"].examples["example-0001"];
            }
            const examples = specMethod.requestBody["content"]["application/json"].examples;
            const dataString = JSON.stringify(data);
            for (const example in examples) {
                const compare = JSON.stringify(examples[example]['value']);
                if (dataString === compare)
                    return;
            }
            examples["example-0001"]["value"] = merge(examples["example-0001"]["value"], data, { arrayMerge: overwriteMerge });
            examples[`example-${pad(Object.keys(examples).length + 1, 4)}`] = {
                value: data
            };
        }
        catch (err) {
        }
    }
    else {
        if (!specMethod['requestBody']) {
            specMethod['requestBody'] = {
                "content": {
                    "multipart/form-data": {
                        "schema": {
                            "properties": {
                                "filename": {
                                    "description": "",
                                    "format": "binary",
                                    "type": "string"
                                }
                            },
                            "type": "object"
                        }
                    }
                }
            };
        }
    }
};
const mergeResponseExample = (specMethod, statusString, content, method, filteredUrl) => {
    try {
        const data = JSON.parse(content.encoding == 'base64' ? Buffer.from(content.text, 'base64').toString() : content.text);
        delete data['traceback'];
        if (data !== null && Object.keys(data).length > 1) {
            if (!specMethod.responses[statusString]['content']) {
                specMethod.responses[statusString]['content'] = {
                    "application/json": {
                        "examples": {
                            "example-0001": {
                                value: {}
                            }
                        },
                        "schema": {
                            "properties": {},
                            "type": "object"
                        }
                    }
                };
            }
            const examples = specMethod.responses[statusString].content["application/json"].examples;
            const dataString = JSON.stringify(data);
            for (const example in examples) {
                const compare = JSON.stringify(examples[example]['value']);
                if (dataString === compare)
                    return;
            }
            examples["example-0001"]["value"] = merge(examples["example-0001"]["value"], data, { arrayMerge: overwriteMerge });
            examples[`example-${pad(Object.keys(examples).length + 1, 4)}`] = {
                value: data
            };
            if (data.description)
                specMethod.description = data.description;
            if (data.element)
                specMethod.meta['element'] = data.element;
        }
    }
    catch (err) {
    }
};
const overwriteMerge = (destinationArray, sourceArray) => sourceArray;
const parseHarFileIntoIndividualFiles = (filename) => {
    const file = fs_1.readFileSync(`input/${filename}`, 'utf8');
    try {
        const data = JSON.parse(file);
        if (!data.log) {
            console.log('Invalid har file');
            process_1.exit(1);
        }
        data.log.entries.forEach((item, index) => {
            if (item.response.content.encoding === 'base64') {
                data.log.entries[index].response.content.text = Buffer.from(item.response.content.text, 'base64').toString();
                delete data.log.entries[index].response.content.encoding;
            }
            fs_1.writeFileSync(`output/individualHars/${filename.replace(/\//g, '-')}-${index}.json`, JSON.stringify(data.log.entries[index], null, 2));
        });
    }
    catch (err) {
        console.log(`${filename} contains invalid json`);
        process_1.exit(1);
    }
};
exports.parseHarFileIntoIndividualFiles = parseHarFileIntoIndividualFiles;
const parseHarFile = (filename) => {
    const file = fs_1.readFileSync(filename, 'utf8');
    try {
        const data = JSON.parse(file);
        if (!data.log) {
            console.log('Invalid har file');
            process_1.exit(1);
        }
        data.log.entries.forEach((item, index) => {
            if (item.response.content.encoding === 'base64') {
                data.log.entries[index].response.content.text = Buffer.from(item.response.content.text, 'base64').toString();
                delete data.log.entries[index].response.content.encoding;
            }
        });
        fs_1.writeFileSync(`output/${filename.replace(/\//g, '-')}`, JSON.stringify(data, null, 2));
        return data;
    }
    catch (err) {
        console.log(`${filename} contains invalid json`);
        process_1.exit(1);
    }
};
const parseJsonFile = (filename) => {
    const file = fs_1.readFileSync(filename, 'utf8');
    try {
        return JSON.parse(file);
    }
    catch (err) {
        console.log(`${filename} contains invalid json`);
        process_1.exit(1);
    }
};
const replaceApos = (s) => s;
const writeExamples = (spec) => {
    const specExamples = {};
    Object.keys(spec.paths).forEach(path => {
        specExamples[path] = {};
        Object.keys(spec.paths[path]).forEach(lMethod => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            if (lMethod === 'parameters')
                return;
            if (lMethod === 'options')
                return;
            specExamples[path][lMethod] = {
                request: {},
                response: {}
            };
            const method = spec.paths[path][lMethod];
            let examples = (_c = (_b = (_a = method.requestBody) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b["application/json"]) === null || _c === void 0 ? void 0 : _c.examples;
            if (examples) {
                let shoji = false;
                for (const example in examples) {
                    if ((_d = examples[example]['value']['element']) === null || _d === void 0 ? void 0 : _d.includes('shoji'))
                        shoji = true;
                }
                const exampleCount = Object.keys(examples).length;
                let exampleNum = 0;
                for (const example in examples) {
                    exampleNum++;
                    if (exampleNum < 2 || exampleCount != 2) {
                        if (!shoji || ((_e = examples[example]['value']['element']) === null || _e === void 0 ? void 0 : _e.includes('shoji'))) {
                            specExamples[path][lMethod]['request'][example] = examples[example]['value'];
                        }
                        else {
                        }
                    }
                }
            }
            for (const status in method.responses) {
                examples = (_j = (_h = (_g = (_f = method.responses) === null || _f === void 0 ? void 0 : _f[status]) === null || _g === void 0 ? void 0 : _g.content) === null || _h === void 0 ? void 0 : _h["application/json"]) === null || _j === void 0 ? void 0 : _j.examples;
                if (examples) {
                    specExamples[path][lMethod]['response'][status] = {};
                    const exampleCount = Object.keys(examples).length;
                    let exampleNum = 0;
                    for (const example in examples) {
                        exampleNum++;
                        if (exampleNum < 2 || exampleCount != 2)
                            specExamples[path][lMethod]['response'][status][example] = examples[example]['value'];
                    }
                }
            }
        });
    });
    const sortedExamples = sortJson(specExamples, { depth: 200 });
    fs_1.writeFileSync('output/examples.yaml', YAML.dump(sortedExamples));
    fs_1.writeFileSync('output/examples.json', JSON.stringify(sortedExamples, null, 2));
};
const shortenExamples = (spec) => {
    Object.keys(spec.paths).forEach(path => {
        Object.keys(spec.paths[path]).forEach(lMethod => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
            const method = spec.paths[path][lMethod];
            let data = (_g = (_f = (_e = (_d = (_c = (_b = (_a = method.requestBody) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b["application/json"]) === null || _c === void 0 ? void 0 : _c.examples) === null || _d === void 0 ? void 0 : _d['example-1']) === null || _e === void 0 ? void 0 : _e.value) === null || _f === void 0 ? void 0 : _f.body) === null || _g === void 0 ? void 0 : _g.table;
            if (data) {
                const dataKeys = ['metadata'];
                dataKeys.forEach(dataKey => {
                    if (data[dataKey] && Object.keys(data[dataKey].length > 2)) {
                        const keys = Object.keys(data[dataKey]);
                        const newData = {};
                        for (let i = 2; i > 0; i--) {
                            newData[keys[keys.length - i]] = data[dataKey][keys[keys.length - i]];
                        }
                        data[dataKey] = newData;
                    }
                });
            }
            data = (_m = (_l = (_k = (_j = (_h = method.requestBody) === null || _h === void 0 ? void 0 : _h.content) === null || _j === void 0 ? void 0 : _j["application/json"]) === null || _k === void 0 ? void 0 : _k.examples) === null || _l === void 0 ? void 0 : _l['example-1']) === null || _m === void 0 ? void 0 : _m.value;
            if (data) {
                const dataKeys = ['variables', 'index'];
                dataKeys.forEach(dataKey => {
                    if (data[dataKey] && Object.keys(data[dataKey].length > 3)) {
                        const keys = Object.keys(data[dataKey]);
                        const newData = {};
                        for (let i = 3; i > 0; i--) {
                            newData[keys[keys.length - i]] = data[dataKey][keys[keys.length - i]];
                        }
                        data[dataKey] = newData;
                    }
                });
            }
            data = (_u = (_t = (_s = (_r = (_q = (_p = (_o = method.requestBody) === null || _o === void 0 ? void 0 : _o.content) === null || _p === void 0 ? void 0 : _p["application/json"]) === null || _q === void 0 ? void 0 : _q.examples) === null || _r === void 0 ? void 0 : _r['example-1']) === null || _s === void 0 ? void 0 : _s.value) === null || _t === void 0 ? void 0 : _t.body) === null || _u === void 0 ? void 0 : _u.preferences;
            if (data) {
                const dataKeys = ['openedDecks'];
                dataKeys.forEach(dataKey => {
                    if (data[dataKey] && Object.keys(data[dataKey].length > 2)) {
                        const keys = Object.keys(data[dataKey]);
                        const newData = {};
                        for (let i = 2; i > 0; i--) {
                            newData[keys[keys.length - i]] = data[dataKey][keys[keys.length - i]];
                        }
                        data[dataKey] = newData;
                    }
                });
            }
            for (const status in method.responses) {
                const data = (_0 = (_z = (_y = (_x = (_w = (_v = method.responses) === null || _v === void 0 ? void 0 : _v[status]) === null || _w === void 0 ? void 0 : _w.content) === null || _x === void 0 ? void 0 : _x["application/json"]) === null || _y === void 0 ? void 0 : _y.examples) === null || _z === void 0 ? void 0 : _z['example-1']) === null || _0 === void 0 ? void 0 : _0.value;
                if (data) {
                    const dataKeys = ['metadata', 'index', 'graph'];
                    dataKeys.forEach(dataKey => {
                        if (data[dataKey] && Object.keys(data[dataKey].length > 2)) {
                            const keys = Object.keys(data[dataKey]);
                            const newData = {};
                            for (let i = 2; i > 0; i--) {
                                newData[keys[keys.length - i]] = data[dataKey][keys[keys.length - i]];
                            }
                            data[dataKey] = newData;
                        }
                    });
                }
            }
        });
    });
};
const validateExampleList = (exampleObject, exampleObjectName, exampleFilename) => {
    const exampleCount = Object.keys(exampleObject).length;
    let gexampleCount = 0;
    const allExamples = [];
    const publishExamplesArray = [];
    for (const exampleName in exampleObject) {
        allExamples.push(JSON.stringify(exampleObject[exampleName]));
        if (exampleName.includes('gexample')) {
            gexampleCount += 1;
            publishExamplesArray.push(exampleObject[exampleName]);
        }
    }
    if (exampleCount && !gexampleCount) {
        console.log(`${exampleObjectName} has ${exampleCount} examples with no gexamples - edit ${exampleFilename} again`);
        process_1.exit(1);
    }
    const padWidth = Math.floor(publishExamplesArray.length / 10) + 1;
    const publishExamples = {};
    let firstExample;
    for (let i = 0; i < publishExamplesArray.length; i++) {
        const exampleName = `example-${pad(i + 1, padWidth)}`;
        if (!firstExample)
            firstExample = publishExamplesArray[i];
        publishExamples[exampleName] = { value: publishExamplesArray[i] };
    }
    return {
        allExamples,
        publishExamples,
        firstExample
    };
};
const generateSchema = (exampleFilename) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const masterExamples = parseJsonFile(exampleFilename);
    const oldSpec = parseJsonFile('output/examples.spec.json');
    const newSpec = {
        openapi: oldSpec.openapi,
        info: oldSpec.info,
        servers: oldSpec.servers,
        paths: {}
    };
    for (const path in masterExamples) {
        if (oldSpec.paths[path]) {
            newSpec.paths[path] = oldSpec.paths[path];
        }
        else {
            newSpec.paths[path] = {};
        }
        for (const method in masterExamples[path]) {
            if (!newSpec.paths[path][method]) {
                let operationId = path.replace(/(^\/|\/$|{|})/g, "").replace(/\//g, "-");
                operationId = `${method}-${operationId}`;
                newSpec.paths[path][method] = {
                    operationId,
                    summary: operationId,
                    description: "",
                    parameters: [],
                    responses: {},
                    tags: ['UNKNOWN'],
                    meta: {
                        originalPath: `https://app.crunch.io/api${path}`
                    },
                };
            }
            const methodObject = newSpec.paths[path][method];
            const numExamples = Object.keys(masterExamples[path][method].request).length;
            console.log(path, method, 'request', numExamples);
            if (numExamples) {
                const exampleStats = validateExampleList(masterExamples[path][method].request, `${path} ${method} requests`, exampleFilename);
                const jsonSchema = yield quicktypeJSON('schema', [path, method, 'request'].join("-"), exampleStats.allExamples);
                if ((_a = jsonSchema.properties) === null || _a === void 0 ? void 0 : _a.element) {
                    switch (exampleStats.firstExample.element) {
                        case 'shoji:entity':
                            jsonSchema.properties.element = {
                                $ref: '#/components/schemas/Shoji-entity-element'
                            };
                            break;
                        case 'shoji:catalog':
                            jsonSchema.properties.element = {
                                $ref: '#/components/schemas/Shoji-catalog-element'
                            };
                            break;
                        case 'shoji:view':
                            jsonSchema.properties.element = {
                                $ref: '#/components/schemas/Shoji-view-element'
                            };
                            break;
                    }
                }
                if (!methodObject.requestBody)
                    methodObject.requestBody = {
                        content: {
                            "application/json": {}
                        }
                    };
                methodObject.requestBody.content["application/json"].schema = yield toOpenApiSchema(jsonSchema)
                    .catch(err => {
                    console.log('ERROR CONVERTING TO OPENAPI SCHEMA, USING JSON SCHEMA');
                    methodObject.requestBody.content["application/json"].schema = jsonSchema;
                });
                methodObject.requestBody.content["application/json"].examples = exampleStats.publishExamples;
            }
            for (const statusCode in masterExamples[path][method].response) {
                const numExamples = Object.keys(masterExamples[path][method].response[statusCode]).length;
                console.log(path, method, statusCode, numExamples);
                if (numExamples) {
                    const exampleStats = validateExampleList(masterExamples[path][method].response[statusCode], `${path} ${method} requests`, exampleFilename);
                    const jsonSchema = yield quicktypeJSON('schema', [path, method, 'request'].join("-"), exampleStats.allExamples);
                    if ((_b = jsonSchema.properties) === null || _b === void 0 ? void 0 : _b.element) {
                        switch (exampleStats.firstExample.element) {
                            case 'shoji:entity':
                                jsonSchema.properties.element = {
                                    $ref: '#/components/schemas/Shoji-entity-element'
                                };
                                break;
                            case 'shoji:catalog':
                                jsonSchema.properties.element = {
                                    $ref: '#/components/schemas/Shoji-catalog-element'
                                };
                                break;
                            case 'shoji:view':
                                jsonSchema.properties.element = {
                                    $ref: '#/components/schemas/Shoji-view-element'
                                };
                                break;
                        }
                    }
                    if (!methodObject.responses[statusCode]) {
                        methodObject.responses[statusCode] = {
                            content: {
                                "application/json": {}
                            }
                        };
                    }
                    methodObject.responses[statusCode].content["application/json"].schema = yield toOpenApiSchema(jsonSchema)
                        .catch(err => {
                        console.log('ERROR CONVERTING TO OPENAPI SCHEMA, USING JSON SCHEMA');
                        methodObject.responses[statusCode].content["application/json"].schema = jsonSchema;
                    });
                    methodObject.responses[statusCode].content["application/json"].examples = exampleStats.publishExamples;
                }
            }
        }
    }
    return newSpec;
});
exports.generateSchema = generateSchema;
const updateXcode = (filename) => {
    console.log(filename);
    const file = YAML.safeLoad(fs_1.readFileSync(filename));
    createXcodeSamples(file);
    fs_1.writeFileSync(filename, YAML.safeDump(file));
};
exports.updateXcode = updateXcode;
const QAPaths = (spec) => {
    Object.keys(spec.paths).forEach(path => {
        Object.keys(spec.paths[path]).forEach(lMethod => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            if (lMethod === 'parameters')
                return;
            const method = spec.paths[path][lMethod];
            const examples = (_c = (_b = (_a = method.requestBody) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b["application/json"]) === null || _c === void 0 ? void 0 : _c.examples;
            let firstExample;
            if (examples) {
                const exampleList = Object.keys(examples);
                for (let exampleName of exampleList) {
                    const exampleData = (_h = (_g = (_f = (_e = (_d = method.requestBody) === null || _d === void 0 ? void 0 : _d.content) === null || _e === void 0 ? void 0 : _e["application/json"]) === null || _f === void 0 ? void 0 : _f.examples) === null || _g === void 0 ? void 0 : _g[exampleName]) === null || _h === void 0 ? void 0 : _h.value;
                    if (!firstExample)
                        firstExample = exampleData;
                    const elementType = exampleData.element;
                    if (!elementType) {
                        console.log(path, lMethod, exampleName, 'NO SHOJI ELEMENT');
                    }
                }
            }
            const requestSchemaElement = (_o = (_m = (_l = (_k = (_j = method.requestBody) === null || _j === void 0 ? void 0 : _j.content) === null || _k === void 0 ? void 0 : _k["application/json"]) === null || _l === void 0 ? void 0 : _l.schema) === null || _m === void 0 ? void 0 : _m.properties) === null || _o === void 0 ? void 0 : _o.element;
            if (requestSchemaElement) {
                if (!requestSchemaElement['$ref']) {
                    console.log(requestSchemaElement);
                    console.log('element', firstExample.element);
                    switch (firstExample.element) {
                        case "shoji:order":
                            method.requestBody.content["application/json"].schema.properties.element = { '$ref': '#/components/schemas/Shoji-order-element' };
                            break;
                        case "shoji:entity":
                            method.requestBody.content["application/json"].schema.properties.element = { '$ref': '#/components/schemas/Shoji-entity-element' };
                            break;
                        case "shoji:catalog":
                            method.requestBody.content["application/json"].schema.properties.element = { '$ref': '#/components/schemas/Shoji-catalog-element' };
                            break;
                        case "shoji:view":
                            method.requestBody.content["application/json"].schema.properties.element = { '$ref': '#/components/schemas/Shoji-view-element' };
                            break;
                    }
                }
            }
            if (method.responses) {
                for (let responseCode in method.responses) {
                    if (responseCode == '404') {
                        const responseExampleMessage = (_s = (_r = (_q = (_p = method.responses[responseCode].content) === null || _p === void 0 ? void 0 : _p['application/json']) === null || _q === void 0 ? void 0 : _q.examples['example-1']) === null || _r === void 0 ? void 0 : _r.value) === null || _s === void 0 ? void 0 : _s.message;
                        if (responseExampleMessage == 'Nothing matches the given URI') {
                            console.log(responseExampleMessage);
                            delete method.responses[responseCode];
                        }
                    }
                    if (responseCode == '202') {
                        method.responses[responseCode] = {
                            "content": {
                                "application/json": {
                                    "examples": {
                                        "example-1": {
                                            "value": {
                                                "element": "shoji:view",
                                                "self": "https://app.crunch.io/api/datasets/a5a3d3890a6e453d85662e9c66a9b7e9/decks/5f9720247f1145d6918d0a4463b17131/export/",
                                                "value": "https://app.crunch.io/api/progress/3Aa5a3d3890a6e453d85662e9c66a9b7e9%24a3af7cb7765f3fee01c49225bf34415d/"
                                            }
                                        }
                                    },
                                    "schema": {
                                        "$ref": '#/components/schemas/202-response'
                                    }
                                }
                            },
                            "description": "Asynchronous task started. \n\nThe `location` header contains a URL for the resource requested, which will become available when the asynchronous task has completed.\n\nThe `value` element in the JSON response contains a progress URL which you can query to monitor task completion. See **Task progress** endpoint for more details.",
                            "headers": {
                                "Location": {
                                    "description": "URL for resource requested, available when the asynchronous task has completed.",
                                    "schema": {
                                        "type": "string"
                                    }
                                }
                            }
                        };
                    }
                }
            }
        });
    });
};
const postProduction = () => {
    const yamlFiles = [];
    recursive("/home/dcarr/git/crunch/zoom/server/src/cr/server/api", ["*.py*"], function (err, files) {
        for (const filename of files) {
            if (filename.includes("openapi") && !filename.includes("openapi.json")) {
                console.log(`ANALYZING OPENAPI FILE ${filename}`);
                const file = YAML.safeLoad(fs_1.readFileSync(filename));
                createXcodeSamples(file);
                QAPaths(file);
                fs_1.writeFileSync(filename, YAML.safeDump(file));
            }
        }
    });
};
exports.postProduction = postProduction;
const listEndpoints = () => {
    const file = fs_1.readFileSync('/home/dcarr/git/crunch/zoom/server/src/cr/server/api/static/openapi.json', 'utf8');
    const spec = JSON.parse(file);
    Object.keys(spec.paths).forEach(path => {
        Object.keys(spec.paths[path]).forEach(lMethod => {
            if (lMethod !== 'parameters') {
                const method = spec.paths[path][lMethod];
                const methodPath = `${lMethod.toUpperCase()} ${path}`;
                const url = `https://crunch.io/api/reference/#${lMethod}-${path.replace(/[{}]/g, '-')}`;
                console.log([
                    methodPath,
                    method.summary,
                    url
                ].join('\t'));
            }
        });
    });
};
exports.listEndpoints = listEndpoints;
