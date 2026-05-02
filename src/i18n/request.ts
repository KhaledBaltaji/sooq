import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

export default getRequestConfig(async () => {
  // Check cookie first (user preference)
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("locale")?.value;

  if (localeCookie && ["en", "ar"].includes(localeCookie)) {
    return {
      locale: localeCookie,
      messages: (await import(`./messages/${localeCookie}.json`)).default,
    };
  }

  // Fall back to Accept-Language header
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language") || "";
  const locale = acceptLanguage.includes("ar") ? "ar" : "en";

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
