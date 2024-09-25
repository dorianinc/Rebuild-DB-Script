require("dotenv").config();
const readline = require("readline");
const axios = require("axios");

const databaseName = null; // this will be the name of your new database
const databaseKey = null; // this will be the name of the key in your env
const baseUrl = "https://api.render.com/v1";
const key = process.env.API_KEY;

const options = {
  headers: {
    accept: "application/json",
    "Content-Type": "application/json",
    authorization: `Bearer ${key}`,
  },
};

const fetchOwner = async () => {
  try {
    const response = await axios.get(`${baseUrl}/owners?limit=1`, options);
    if (response.status === 200) {
      const { owner } = response.data[0];
      return owner;
    }
  } catch (error) {
    console.error("Error fetching owner:", error);
    throw error;
  }
};

// Service --------------------------------------------------------------------------------------------

const fetchServices = async () => {
  try {
    const response = await axios.get(`${baseUrl}/services`, options);
    const services = response.data.filter(
      (item) => item.service.type === "web_service"
    );

    return services.filter((service) => service !== null);
  } catch (error) {
    console.error("Error fetching services:", error);
    throw error;
  }
};

const deployService = async (serviceId) => {
  const body = {
    clearCache: "do_not_clear",
  };

  try {
    const response = await axios.post(
      `${baseUrl}/services/${serviceId}/deploys`,
      body,
      options
    );
    return response.data;
  } catch (error) {
    console.error(`Error deploying service ID ${serviceId}:`, error);
    throw error;
  }
};

// Database --------------------------------------------------------------------------------------------

const fetchDatabase = async () => {
  try {
    const response = await axios.get(`${baseUrl}/postgres`, options);
    return response.data.length ? response.data[0].postgres : {};
  } catch (error) {
    console.error("Error fetching database:", error);
    throw error;
  }
};

const fetchConnectionInfo = async (databaseId) => {
  try {
    const response = await axios.get(
      `${baseUrl}/postgres/${databaseId}/connection-info`,
      options
    );
    return response.data;
  } catch (error) {
    console.error(
      `Error fetching details for database ID ${databaseId}:`,
      error
    );
    throw error;
  }
};

const createDatabase = async (ownerId) => {
  const body = {
    enableHighAvailability: false,
    plan: "free",
    version: "16",
    name: databaseName,
    ownerId,
  };

  try {
    const response = await axios.post(`${baseUrl}/postgres`, body, options);
    return response.data;
  } catch (error) {
    console.error("Error creating database:", error);
    throw error;
  }
};

const deleteDatabase = async (databaseId) => {
  try {
    const response = await axios.delete(
      `${baseUrl}/postgres/${databaseId}`,
      options
    );
    return response;
  } catch (error) {
    console.error(`Error deleting database ID ${databaseId}:`, error);
    throw error;
  }
};

const rebuildDatabase = async () => {
  console.log("Rebuilding database...");
  try {
    const owner = await fetchOwner();
    const services = await fetchServices();
    const database = await fetchDatabase();

    if (!isEmpty(database)) {
      const deleteDb = await deleteDatabase(database.id);
      if (deleteDb.status !== 204) {
        console.error("Failed to delete existing database.");
        return;
      }
    }

    const { name, status, id, createdAt } = await createDatabase(owner.id);
    const newDb = { name, status, id, createdAt };
    const { internalConnectionString } = await fetchConnectionInfo(id);
    newDb.internalDatabaseUrl = internalConnectionString;

    for (const service of services) {
      await updateEnvVariable(
        service.id,
        databaseKey,
        newDb.internalDatabaseUrl
      );
      await deployService(service.id);
    }
    console.log("done!");
  } catch (error) {
    console.error("Error during database rebuild:", error);
  }
};

// ENV --------------------------------------------------------------------------------------------

const updateEnvVariable = async (serviceId, envKey, envValue) => {
  const body = {
    value: envValue,
  };

  try {
    const response = await axios.put(
      `${baseUrl}/services/${serviceId}/env-vars/${envKey}`,
      body,
      options
    );
    return response.data;
  } catch (error) {
    console.error(
      `Error updating environment variable for service ID ${serviceId}:`,
      error
    );
    throw error;
  }
};

// Helper --------------------------------------------------------------------------------------------

const isEmpty = (obj) => {
  return Object.values(obj).length === 0;
};

// Etc --------------------------------------------------------------------------------------------

const runScript = async () => {
  const chalk = (await import("chalk")).default;
  let missing = [];

  if (!databaseName) {
    missing.push(chalk.red("databaseName"));
  }
  if (!databaseKey) {
    missing.push(chalk.red("databaseKey"));
  }
  if (!baseUrl) {
    missing.push(chalk.red("baseUrl"));
  }
  if (!key) {
    missing.push(chalk.red("key"));
  }

  if (missing.length) {
    console.log(
      chalk.yellow(
        `The following variables still don't have a value: ${missing.join(
          ", "
        )}`
      )
    );
    console.log(chalk.yellow("Please add them for the script to run..."));
    return;
  }

  console.log(chalk.green("All variables are set. Rebuilding database...\n"));
  rebuildDatabase();
};

// User Interface --------------------------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const showMenu = async () => {
  const chalk = (await import("chalk")).default;

  console.log(chalk.cyan.bold("\n1. Rebuild Database"));
  console.log(chalk.cyan.bold("2. View Database Details"));
  console.log(chalk.cyan.bold("3. View Service Details"));
  console.log(chalk.cyan.bold("4. Exit"));

  rl.question(chalk.yellow("Choose an option: "), async (answer) => {
    switch (answer) {
      case "1":
        console.log(chalk.green("\nRunning Rebuild Script..."));
        await runScript();
        rl.close();
        break;
      case "2":
        console.log(chalk.green("Fetching Database Details..."));
        let database = await fetchDatabase();
        let connectionInfo = await fetchConnectionInfo(database.id);
        console.log(chalk.cyan.bold("🖥️  Database: "), database);
        console.log(chalk.cyan.bold("🖥️  Connection Info: "), connectionInfo);
        rl.close();
        break;
      case "3":
        console.log(chalk.green("Fetching Service Details..."));
        let services = await fetchServices();
        console.log(chalk.cyan.bold("🖥️  Services: "), services);
        rl.close();
        break;
      case "4":
        console.log(chalk.red("Exiting program..."));
        rl.close();
        break;
      default:
        console.log(chalk.red("Invalid option. Please try again."));
        rl.close();
    }
  });
};

rl.on("close", async () => {
  const chalk = (await import("chalk")).default;

  console.log(chalk.bgRed.white.bold("\nExiting program."));
  setTimeout(() => {
    process.exit(0);
  }, 5000);
});

showMenu();
