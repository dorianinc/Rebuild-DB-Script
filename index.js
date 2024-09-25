require("dotenv").config();
const axios = require("axios");

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
    throw error; // Optionally re-throw the error after logging
  }
};

const fetchServices = async () => {
  try {
    const response = await axios.get(`${baseUrl}/services`, options);
    const services = response.data
      .filter((item) => item.service.type === "web_service")
      .map((item) => item.service);

    const detailedServices = await Promise.all(
      services.map(async ({ name, id, type }) => {
        try {
          const details = await fetchEventDetails(id);
          return { name, id, type, details };
        } catch (error) {
          console.error(`Error fetching details for service ID ${id}:`, error);
          return null; // Return null for services that fail to fetch details
        }
      })
    );

    return detailedServices.filter((service) => service !== null); // Filter out failed services
  } catch (error) {
    console.error("Error fetching services:", error);
    throw error; // Optionally re-throw the error after logging
  }
};

const fetchEventDetails = async (serviceId) => {
  try {
    const response = await axios.get(
      `${baseUrl}/services/${serviceId}/events`,
      options
    );
    const latestDetails = response.data.reduce((obj, item) => {
      const event = item.event;
      if (event.type === "deploy_ended") {
        obj = { ...event.details, lastDeployed: event.timestamp };
      }
      return obj;
    }, {});
    return latestDetails;
  } catch (error) {
    console.error(
      `Error fetching event details for service ID ${serviceId}:`,
      error
    );
    throw error; // Re-throw the error for handling upstream
  }
};

const fetchDatabase = async () => {
  try {
    const response = await axios.get(`${baseUrl}/postgres`, options);
    return response.data.length ? response.data[0].postgres : {};
  } catch (error) {
    console.error("Error fetching database:", error);
    throw error; // Re-throw the error for handling upstream
  }
};

const fetchDatabaseDetails = async (databaseId) => {
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
    throw error; // Re-throw the error for handling upstream
  }
};

const createDatabase = async (dbName, ownerId) => {
  const body = {
    enableHighAvailability: false,
    plan: "free",
    version: "16",
    name: dbName,
    ownerId,
  };

  try {
    const response = await axios.post(`${baseUrl}/postgres`, body, options);
    return response.data;
  } catch (error) {
    console.error("Error creating database:", error);
    throw error; // Re-throw the error for handling upstream
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
    throw error; // Re-throw the error for handling upstream
  }
};

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
    throw error; // Re-throw the error for handling upstream
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
    throw error; // Re-throw the error for handling upstream
  }
};

const isEmpty = (obj) => {
  return Object.values(obj).length === 0;
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
        return; // Exit if deletion fails
      }
    }

    const { name, status, id, createdAt } = await createDatabase(
      "my-db",
      owner.id
    );
    const newDb = { name, status, id, createdAt };
    const { internalConnectionString } = await fetchDatabaseDetails(id);
    newDb.internalDatabaseUrl = internalConnectionString;

    for (const service of services) {
      await updateEnvVariable(
        service.id,
        "DATABASE_URL",
        newDb.internalDatabaseUrl
      );
      await deployService(service.id);
    }
    console.log("done!");
  } catch (error) {
    console.error("Error during database rebuild:", error);
  }
};

// Start the rebuild process
rebuildDatabase();
