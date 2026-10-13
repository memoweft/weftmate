/* Test-only OS isolation. Electron safeStorage and Security encryption stay real.
 * Redirect keychain operations to one disposable file; never set search/default
 * preferences. Private keychain creation does not add it to the user search list.
 */
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static SecKeychainRef isolated;
static void fail(const char *where, OSStatus status) {
  fprintf(stderr, "M3_3B_KEYCHAIN_FAILURE %s %d\n", where, (int)status); _exit(73);
}
static void setup(void) {
  if (isolated) return;
  const char *path = getenv("M3_3B_KEYCHAIN_FILE"), *password = getenv("M3_3B_KEYCHAIN_PASSWORD");
  if (!path || !password) { fprintf(stderr, "Missing temporary keychain configuration\n"); _exit(73); }
  SecKeychainSetUserInteractionAllowed(false);
  OSStatus status;
  if (access(path, F_OK) == 0) status = SecKeychainOpen(path, &isolated);
  else status = SecKeychainCreate(path, (UInt32)strlen(password), password, false, NULL, &isolated);
  if (status) fail("open/create", status);
  status = SecKeychainUnlock(isolated, (UInt32)strlen(password), password, true);
  if (status) fail("unlock", status);
}
static CFDictionaryRef scoped(CFDictionaryRef original, int add) {
  setup();
  CFTypeRef service = CFDictionaryGetValue(original, kSecAttrService);
  if (service && CFGetTypeID(service) == CFStringGetTypeID()) {
    char name[256]; if (CFStringGetCString(service, name, sizeof(name), kCFStringEncodingUTF8)) fprintf(stderr, "M3_3B_KEYCHAIN_SERVICE %s\n", name);
  }
  CFMutableDictionaryRef query = CFDictionaryCreateMutableCopy(NULL, 0, original);
  CFArrayRef list = CFArrayCreate(NULL, (const void **)&isolated, 1, &kCFTypeArrayCallBacks);
  CFDictionarySetValue(query, add ? kSecUseKeychain : kSecMatchSearchList, add ? (CFTypeRef)isolated : (CFTypeRef)list);
  CFDictionarySetValue(query, kSecUseAuthenticationUI, kSecUseAuthenticationUIFail);
  CFRelease(list);
  return query;
}
static OSStatus isolatedCopy(CFDictionaryRef input, CFTypeRef *result) {
  CFDictionaryRef query = scoped(input, 0); OSStatus s = SecItemCopyMatching(query, result); CFRelease(query);
  fprintf(stderr, "M3_3B_KEYCHAIN copy %d\n", (int)s); return s;
}
static OSStatus isolatedAdd(CFDictionaryRef input, CFTypeRef *result) {
  CFDictionaryRef query = scoped(input, 1); OSStatus s = SecItemAdd(query, result); CFRelease(query);
  fprintf(stderr, "M3_3B_KEYCHAIN add %d\n", (int)s); return s;
}
static OSStatus isolatedUpdate(CFDictionaryRef input, CFDictionaryRef attrs) {
  CFDictionaryRef query = scoped(input, 0); OSStatus s = SecItemUpdate(query, attrs); CFRelease(query); return s;
}
static OSStatus isolatedDelete(CFDictionaryRef input) {
  CFDictionaryRef query = scoped(input, 0); OSStatus s = SecItemDelete(query); CFRelease(query); return s;
}
static OSStatus isolatedFind(CFTypeRef ignored, UInt32 sl, const char *service, UInt32 al, const char *account, UInt32 *length, void **data, SecKeychainItemRef *item) {
  setup();
  OSStatus s = SecKeychainFindGenericPassword(isolated, sl, service, al, account, length, data, item);
  fprintf(stderr, "M3_3B_KEYCHAIN find %d\n", (int)s); return s;
}
static OSStatus isolatedLegacyAdd(SecKeychainRef ignored, UInt32 sl, const char *service, UInt32 al, const char *account, UInt32 length, const void *data, SecKeychainItemRef *item) {
  setup();
  OSStatus s = SecKeychainAddGenericPassword(isolated, sl, service, al, account, length, data, item);
  fprintf(stderr, "M3_3B_KEYCHAIN legacy-add %d\n", (int)s); return s;
}
#define INTERPOSE(replacement, original) \
__attribute__((used)) static struct { const void *replacement; const void *original; } pair_##original \
__attribute__((section("__DATA,__interpose"))) = { (const void *)replacement, (const void *)original };
INTERPOSE(isolatedCopy, SecItemCopyMatching)
INTERPOSE(isolatedAdd, SecItemAdd)
INTERPOSE(isolatedUpdate, SecItemUpdate)
INTERPOSE(isolatedDelete, SecItemDelete)
INTERPOSE(isolatedFind, SecKeychainFindGenericPassword)
INTERPOSE(isolatedLegacyAdd, SecKeychainAddGenericPassword)
