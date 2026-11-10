package com.focusrecovery.global.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class CanonicalJson {
	private final JsonMapper mapper;
	public CanonicalJson(JsonMapper mapper) { this.mapper = mapper; }
	public String write(Object value) { return mapper.writeValueAsString(ordered(mapper.valueToTree(value))); }
	public String fingerprint(Object value) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
				.digest(write(value).getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable"); }
	}
	private Object ordered(JsonNode node) {
		if (node.isObject()) {
			Map<String, Object> sorted = new TreeMap<>();
			node.properties().forEach(entry -> sorted.put(entry.getKey(), ordered(entry.getValue())));
			return sorted;
		}
		if (node.isArray()) {
			var array = new ArrayList<>(); node.forEach(value -> array.add(ordered(value))); return array;
		}
		return node;
	}
}
