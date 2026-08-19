import { factory } from "../http/factory";

const emptyList = {
  data: [],
  object: "list",
  continuationToken: null,
};

export const getEmptyCompatibilityList = factory.createHandlers(async (c) =>
  c.json(emptyList),
);
