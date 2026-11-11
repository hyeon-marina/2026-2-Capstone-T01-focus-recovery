package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.AuthenticatedParticipant;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/collection")
public class CollectionExportController {
    private final CollectionExportService exports;
    public CollectionExportController(CollectionExportService exports){this.exports=exports;}
    @PostMapping("/exports") public Map<String,Object> mine(){return exports.export(AuthenticatedParticipant.required().participantId(),false);}
    @PostMapping("/admin/exports/{participant}") public Map<String,Object> export(@PathVariable UUID participant){return exports.export(participant,true);}
    @GetMapping("/admin/export-privacy/{participant}") public Map<String,Object> privacy(@PathVariable UUID participant){return exports.privacy(participant);}
}
