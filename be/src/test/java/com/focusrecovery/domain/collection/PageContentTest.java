package com.focusrecovery.domain.collection;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import java.time.Instant;
import java.util.*;
class PageContentTest {
 CreatePageVisitRequest page(String title,String text,String query,boolean search) {
  return new CreatePageVisitRequest(UUID.randomUUID().toString(),1,"test-tab","https://www.google.com"+(search?"/search":"")+MetadataPage.MARKER+"a".repeat(64),"www.google.com",title,text,query,search,Instant.now(),5000L,0,0L,"SUCCESS");
 }
 @Test void excludesSensitiveSearchIntent() {
  for(var query:List.of("우울증 증상","대출 신용 점수","cancer treatment","my password","HIV test")) assertThat(MetadataPage.publicSearchQuery(query)).isFalse();
  assertThat(MetadataPage.publicSearchQuery("Python venv documentation")).isTrue();
 }
 @Test void validatesActualTextWithoutRelaxingHmacOrPrivacy() {
  MetadataPage.validateContent(page("Python documentation","한a🙂".repeat(1666),null,false),List.of(),true);
  MetadataPage.validateContent(page("Search results","Actual Python result","Python venv",true),List.of(),true);
  for(var r:List.of(page(MetadataPage.TITLE,MetadataPage.CONTENT,null,false),page("Title","a".repeat(5001),null,false),page("Title","a".repeat(80)+" person@example.org",null,false),page("Title","Public search result","010-1234-5678",true)))
   assertThatThrownBy(()->MetadataPage.validateContent(r,List.of(),true)).isInstanceOf(RuntimeException.class);
 }
}
