const fs = require('fs');
const yaml = require('js-yaml');


function parseYamlOptionsFile(yamlFilePath) {
    const fileContents = fs.readFileSync(yamlFilePath, 'utf8');
    const yamlData = yaml.load(fileContents);

    let groupNameToCommands = new Map();

    for (let groupName in yamlData) {
        if (yamlData.hasOwnProperty(groupName)) {
            const commands = yamlData[groupName].options || [];
            groupNameToCommands.set(groupName, commands);
        }
    }

    return groupNameToCommands;
}

const parsedData = parseYamlOptionsFile("test.yml");

const secrets = {
    GCP_USER_1: 'b',
    secret1: 'c'
};


console.log(replaceCustomEscapedLiteralsInMap(parsedData, secrets));


function replaceCustomEscapedLiteralsInMap(commandMap, secrets = {}) {
    const regex = /%\[\[\s*(env|secrets)\.(\w+)\s*]]/g;

    const transformedMap = new Map();

    commandMap.forEach((commands, phase) => {
        const transformedCommands = [];

        for (let i = 0; i < commands.length; i++) {
            let command = commands[i];

            let match;
            while ((match = regex.exec(command)) !== null) {
                const type = match[1];
                const key = match[2];

                if (type === "env") {
                    command = command.replace(match[0], process.env[key] || match[0]);
                } else if (type === "secrets") {
                    command = command.replace(match[0], secrets[key] || match[0]);
                }
            }

            transformedCommands.push(command);
        }

        transformedMap.set(phase, transformedCommands);
    });

    return transformedMap;
}
