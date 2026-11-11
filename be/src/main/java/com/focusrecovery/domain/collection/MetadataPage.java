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
    public static boolean matches(String url,List<CollectionSitePolicy.Site> sites) {
        return url!=null && sites.stream().anyMatch(s->url.matches(java.util.regex.Pattern.quote(s.origin()+s.pathPrefix().replaceFirst("/$","")+MARKER)+"[a-f0-9]{64}"));
    }
    public static void validate(CreatePageVisitRequest r,List<CollectionSitePolicy.Site> sites) {
        boolean search=r.normalizedUrl()!=null && (r.normalizedUrl().startsWith("https://www.google.com/search/"+"__focus_page__/") || r.normalizedUrl().startsWith("https://search.naver.com/search.naver/__focus_page__/"));
        if(!matches(r.normalizedUrl(),sites) || !validTitle(r.title()) || !CONTENT.equals(r.content()) || !Boolean.valueOf(search).equals(r.isSearchResultPage()) || (search ? !QUERY.equals(r.searchQuery()) : r.searchQuery()!=null) || !URI.create(r.normalizedUrl()).getHost().equals(r.domain()))
            throw new ConflictException("COLLECTION_POLICY_BLOCKED","원본 URL·본문·제목·검색어 대신 고정 메타데이터가 필요합니다.");
    }
}
