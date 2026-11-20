#pragma once
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <string>
typedef int mbedtls_md_type_t;
#define MBEDTLS_MD_SHA256 6
typedef struct { int t; } mbedtls_md_info_t;
typedef struct { std::string key, data; } mbedtls_md_context_t;
inline void mbedtls_md_init(mbedtls_md_context_t* c) { c->key.clear(); c->data.clear(); }
inline const mbedtls_md_info_t* mbedtls_md_info_from_type(int) { static mbedtls_md_info_t i{6}; return &i; }
inline int mbedtls_md_setup(mbedtls_md_context_t*, const mbedtls_md_info_t*, int) { return 0; }
inline int mbedtls_md_hmac_starts(mbedtls_md_context_t* c, const unsigned char* k, size_t n) { c->key.assign((const char*)k, n); return 0; }
inline int mbedtls_md_hmac_update(mbedtls_md_context_t* c, const unsigned char* d, size_t n) { c->data.append((const char*)d, n); return 0; }
inline int mbedtls_md_hmac_finish(mbedtls_md_context_t* c, unsigned char* out) { unsigned int l = 32; HMAC(EVP_sha256(), c->key.data(), c->key.size(), (const unsigned char*)c->data.data(), c->data.size(), out, &l); return 0; }
inline void mbedtls_md_free(mbedtls_md_context_t*) {}
