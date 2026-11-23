import config from "./src/config";
import Logger from "./src/lib/logger";
import Server from "./src/server";

new Server().httpServer.listen(config.port, () => {
  Logger.info(`Notification microservice escuchando en el puerto ${config.port}`, { env: config.env });
});
