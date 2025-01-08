import qs from "qs";

//type CookieStyle = "form";
//type HeaderStyle = "simple";
//type PathStyle = "simple" | "label" | "matrix";
type QueryStyle = "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";

export const parseQuery =
  (style: QueryStyle, explode: boolean) => (query: string) => {
    let decodedQuery = decodeURIComponent(query);

    if (style === "spaceDelimited" && explode === false) {
      decodedQuery = decodedQuery.replaceAll(/ /g, ",");
    }

    if (style === "pipeDelimited" && explode === false) {
      decodedQuery = decodedQuery.replaceAll(/\|/g, ",");
    }

    return qs.parse(decodedQuery, {
      allowDots: true,
      comma: true,
    });
  };

export const parseValue = (query?: string | null) => {
  if (!query) {
    return query;
  } else if ((query as string).includes("=")) {
    return qs.parse(query.replaceAll(",", "&"), {
      allowDots: true,
      comma: true,
    });
  } else if ((query as string).includes(",")) {
    return query.split(",");
  } else {
    return query;
  }
};
