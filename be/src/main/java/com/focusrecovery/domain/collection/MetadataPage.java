package com.focusrecovery.domain.collection;

import java.net.URI;
import java.util.List;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import com.focusrecovery.global.exception.ConflictException;

/** Fixed metadata uses the existing export fields; it never claims to be extracted page text. */
public final class MetadataPage {
    private MetadataPage() {}
    public static final String MARKER="/__focus_page__/";
    public static final String TITLE="Public browsing metadata";
    public static final String CONTENT="METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.";
    public static final String QUERY="[NOT_COLLECTED]";
    private static boolean validTitle(String title) {
        return TITLE.equals(title) || List.of("GIT","ACCESSIBILITY","PYTHON","HTTP_CACHE","RECYCLING","ENERGY","URBAN_CLIMATE","LIGHTING","MATERIALS","HANGUL","ART","LIBRARY","ARCHIVE","MUSIC","GEOLOGY","ASTRONOMY","WEATHER","TRANSPORT","BIOLOGY","TRAVEL","COOKING","HOBBY","OTHER").stream().anyMatch(t->("Topic: "+t).equals(title));
    }
    public static boolean matches(String url,List<CollectionSitePolicy.Site> sites) { return matches(url,sites,false); }
    public static boolean matches(String url,List<CollectionSitePolicy.Site> sites,boolean publicWeb) {
        if(publicWeb) {
            try {
                URI u=URI.create(url);String host=u.getHost();
                if (!("http".equals(u.getScheme()) || "https".equals(u.getScheme())) || host==null || u.getPort()!=-1
                    || u.getUserInfo()!=null || u.getRawQuery()!=null || u.getRawFragment()!=null
                    || !host.matches("(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}")
                    || java.util.regex.Pattern.compile("(?:^|[.-])(localhost|local|internal|intranet|lan|home|corp|private|test|invalid|example|onion|admin|mail|webmail|outlook|gmail|whatsapp|telegram|chat|messages|messenger|slack|discord|teams|bank|banking|finance|paypal|stripe|health|medical|hospital|clinic|login|auth|accounts|account|wallet)(?:[.-]|$)",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(host).find()) return false;
                String prefix=host.matches("(?:www\\.)?google\\.(?:com|co\\.kr|co\\.uk|co\\.jp|[a-z]{2})") ? "/search" : host.matches("(?:search|m\\.search)\\.naver\\.com") ? "/search.naver" : "";
                return u.getRawPath().matches(java.util.regex.Pattern.quote(prefix+MARKER)+"[a-f0-9]{64}")
                    || u.getRawPath().matches(java.util.regex.Pattern.quote(MARKER)+"[a-f0-9]{64}");
            } catch(RuntimeException e) { return false; }
        }
        return url!=null && sites.stream().anyMatch(s->url.matches(java.util.regex.Pattern.quote(s.origin()+s.pathPrefix().replaceFirst("/$","")+MARKER)+"[a-f0-9]{64}"));
    }
    public static void validate(CreatePageVisitRequest r,List<CollectionSitePolicy.Site> sites) { validate(r,sites,false); }
    public static void validate(CreatePageVisitRequest r,List<CollectionSitePolicy.Site> sites,boolean publicWeb) {
        URI page=r.normalizedUrl()==null?null:URI.create(r.normalizedUrl());
        boolean search=page!=null && ((page.getHost().matches("(?:www\\.)?google\\.(?:com|co\\.kr|co\\.uk|co\\.jp|[a-z]{2})") && page.getPath().startsWith("/search"+MARKER))
            || (page.getHost().matches("(?:search|m\\.search)\\.naver\\.com") && page.getPath().startsWith("/search.naver"+MARKER)));
        if(!matches(r.normalizedUrl(),sites,publicWeb) || !validTitle(r.title()) || !CONTENT.equals(r.content()) || !Boolean.valueOf(search).equals(r.isSearchResultPage()) || (search ? !QUERY.equals(r.searchQuery()) : r.searchQuery()!=null) || !URI.create(r.normalizedUrl()).getHost().equals(r.domain()))
            throw new ConflictException("COLLECTION_POLICY_BLOCKED","원본 URL·본문·제목·검색어 대신 고정 메타데이터가 필요합니다.");
    }
    public static boolean publicText(String text) {
        return text != null && !java.util.regex.Pattern.compile(
            "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|[0-9]{6}-[1-4][0-9]{6}|(?:\\+\\d{1,3}[- .])?(?:\\(\\d{2,4}\\)[- .]?|\\b\\d{2,4}[- .])\\d{3,4}[- .]\\d{4}\\b|(?:01[016789]|\\+82[- .]?1[016789])[- .]?[0-9]{3,4}[- .]?[0-9]{4}|bearer\\s+[a-z0-9._-]+|(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:id|token|key|credential)|cookie|passwd|secret)\\s*[:=]\\s*\\S+|\\b(?:diagnosis|prescription|patient|bank account|credit card)\\b|주민등록|계좌번호|진단명|처방전|비밀번호",
            java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text).find();
    }
    public static boolean publicSearchQuery(String query) {
        return publicText(query) && !java.util.regex.Pattern.compile("\\b(?:medical|diagnosis|patient|prescription|symptoms?|treatment|cancer|hiv|aids|depression|banking|finance|loan|credit|insurance|password|cookie|token)\\b|의료|진료|환자|질병|증상|치료|처방|우울|암 검사|대출|신용|계좌|금융|주민|비밀번호",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(query).find();
    }
    public static void validateContent(CreatePageVisitRequest r,List<CollectionSitePolicy.Site> sites,boolean publicWeb) {
        r.validateV2();
        if(!matches(r.normalizedUrl(),sites,publicWeb)) throw invalidContent();
        URI page=URI.create(r.normalizedUrl());
        boolean search=(page.getHost().matches("(?:www\\.)?google\\.(?:com|co\\.kr|co\\.uk|co\\.jp|[a-z]{2})") && page.getPath().startsWith("/search"+MARKER))
            || (page.getHost().matches("(?:search|m\\.search)\\.naver\\.com") && page.getPath().startsWith("/search.naver"+MARKER));
        if(!page.getHost().equals(r.domain()) || !Boolean.valueOf(search).equals(r.isSearchResultPage())
            || r.title().isBlank() || TITLE.equals(r.title()) || r.title().startsWith("Topic: ") || CONTENT.equals(r.content())
            || !publicText(r.title()) || !publicText(r.content()) || search && (!publicSearchQuery(r.searchQuery()) || QUERY.equals(r.searchQuery())
                || !r.searchQuery().equals(r.searchQuery().replaceAll("\\s+"," ").trim()))
            || r.title().matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw invalidContent();
    }
    private static ConflictException invalidContent() {
        return new ConflictException("COLLECTION_POLICY_BLOCKED","공개 본문·제목·검색어와 개인정보 검사를 확인하세요.");
    }
}
