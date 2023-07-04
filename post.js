const core = require('@actions/core')
const fs = require('fs')

async function main() {
    try {
        const directory = core.getState("ansible_directory");
        const keyFile = core.getState("ansible_private_key");
        const inventoryFile = core.getState("ansible_inventory");
        const knownHostsFile = core.getState("ansible_known_hosts");

        if (directory)
            process.chdir(directory);

        if (keyFile)
            remove(keyFile);

        if (inventoryFile)
            remove(inventoryFile);

        if (knownHostsFile)
            remove(knownHostsFile);

    } catch (error) {
        core.setFailed(error.message);
    }
}

function remove(file) {
    if (fs.existsSync(file)) {
        core.info(`Deleting "${file}" file`);
        fs.unlinkSync(file);
    }
}

main();
